/**
 * Contains the daemon logic.
 */
import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import '@polkadot/api-augment';
import cron from 'node-cron';
require('dotenv').config();

import { isValidSeed, ServiceArgs, claimPayout } from './substrate';
import { logger } from './logging';

let cronJob: cron.ScheduledTask;

export async function startPayoutDaemon(isDaemon: boolean, listOnly: boolean) {
    logger.info('Starting...');
    if (process.env.STASHES == null) {
        logger.error(
            'No stashes defined in the .env file. Please view .env.sample file for a valid example.',
        );
        return;
    }
    const stashes = [...new Set(process.env.STASHES!!.split(','))];
    if (process.env.MNEMONIC == null) {
        logger.error(
            'Payout account mnemonic is not defined in the .env file. Please view .env.sample file for a valid example.',
        );
        return;
    }
    if (!isValidSeed(process.env.MNEMONIC!!)) {
        logger.error('Mnemonic in the .env file is invalid.');
        return;
    }
    if (process.env.PAYOUT_CHECK_PERIOD_MINS == null) {
        logger.error(
            'Payout check period is not defined in the .env file. Please view .env.sample file for a valid example.',
        );
        return;
    }
    const payoutCheckPeriodMins = +process.env.PAYOUT_CHECK_PERIOD_MINS!!;
    if (payoutCheckPeriodMins < 1) {
        logger.error(
            `Invalid payout check period value in the .env file: ${payoutCheckPeriodMins}.` +
                ` It can be 1 or more minutes.`,
        );
        return;
    }
    if (listOnly) {
        logger.info('List mode.');
    }
    if (isDaemon) {
        logger.info(`Daemon mode. Will run every ${payoutCheckPeriodMins} minutes.`);
        cronJob = cron.schedule(`*/${payoutCheckPeriodMins} * * * *`, async () => {
            await run(
                stashes,
                process.env.MNEMONIC!! as string,
                +process.env.ERA_DEPTH!!,
                listOnly,
            );
        });
    } else {
        logger.info(`Single-run mode.`);
        await run(stashes, process.env.MNEMONIC!! as string, +process.env.ERA_DEPTH!!, listOnly);
        logger.info('Single-run mode completed.');
    }
}

export async function stopPayoutDaemon() {
    logger.info('Stopping the substrate payout daemon.');
    if (cronJob) {
        cronJob.stop();
    }
}

async function run(
    stashAddresses: string[],
    seedPhrase: string,
    eraDepth: number,
    listOnly: boolean,
) {
    logger.info('Get API connection.');
    const provider = new WsProvider(process.env.SUBSTRATE_RPC_URL as string);
    const api = await ApiPromise.create({
        provider,
    });
    await api.isReady;
    logger.info('API connection is ready, begin payout check.');

    const keyring = new Keyring({ type: 'sr25519' });
    const keypair = keyring.addFromUri(seedPhrase);
    let account = await api.query.system.account(keypair.address);
    let nonce = account.nonce.toBigInt();

    let activeEraIndex = (await api.query.staking.activeEra()).unwrap().index.toNumber();
    let unclaimedPayoutCount = 0;
    for (let stashAddress of stashAddresses) {
        unclaimedPayoutCount = 0;
        for (let eraIndex = Math.max(activeEraIndex - eraDepth, 0); eraIndex < activeEraIndex; eraIndex++) {
            const args = {
                api,
                keypair,
                stashAddress,
                nonce,
                eraIndex,
                listOnly,
            } as ServiceArgs;
            const newNonce = await claimPayout(args);
            if (newNonce) {
                nonce = newNonce;
                unclaimedPayoutCount++;
            }
        }
        if (!listOnly) {
            logger.info(`Claimed ${unclaimedPayoutCount} eras for ${stashAddress}.`);
        }
    }
    logger.info('Close API connection.');
    await api.disconnect();
    logger.info('End payout check.');
    logger.info(
        '-----------------------------------------------------------------------------------------------------',
    );
}
