/**
 * Contains the daemon logic.
 */
import { ApiPromise, WsProvider } from '@polkadot/api';
import cron from 'node-cron';
require('dotenv').config();

import { isValidSeed, ServiceArgs, collectPayouts } from './substrate';
import { logger } from './logging';

let cronJob: cron.ScheduledTask;

export async function startPayoutDaemon() {
    logger.info('Starting the substrate payout daemon.');
    if (process.env.STASHES == null) {
        logger.error('No stashes defined in the .env file. Please view .env.sample file for a valid example.');
        return;
    }
    const stashes = process.env.STASHES!!.split(",");
    if (process.env.MNEMONIC == null) {
        logger.error('Payout account mnemonic is not defined in the .env file. Please view .env.sample file for a valid example.');
        return;
    }
    if (!isValidSeed(process.env.MNEMONIC!!)) {
        logger.error('Mnemonic in the .env file is invalid.');
        return;
    }
    if (process.env.PAYOUT_CHECK_PERIOD_MINS == null) {
        logger.error('Payout check period is not defined in the .env file. Please view .env.sample file for a valid example.');
        return;
    }
    const payoutCheckPeriodMins = +process.env.PAYOUT_CHECK_PERIOD_MINS!!;
    if (payoutCheckPeriodMins < 1 || payoutCheckPeriodMins > 60) {
        logger.error('Invalid payout check period value in the .env file. Please view .env.sample file for a valid example.');
        return;
    }
    cronJob = cron.schedule(`*/${payoutCheckPeriodMins} * * * *`, async () => {
        await makePayouts(
            stashes,
            process.env.MNEMONIC!! as string,
            +process.env.ERA_DEPTH!!
        );
    });
}

export async function stopPayoutDaemon() {
    logger.info('Stopping the substrate payout daemon.');
    if (cronJob) {
        cronJob.stop();
    }
}

async function makePayouts(
    stashes: string[],
    mnemonic: string,
    eraDepth: number
) {
    logger.info('Get API connection.');
    const provider = new WsProvider(process.env.SUBSTRATE_RPC_URL as string);
    const api = await ApiPromise.create({
        provider,
    });
    await api.isReady;
    logger.info('API connection is ready.');
    logger.info('Begin payout check.');
    const args = {
        api: api,
        suri: mnemonic,
        stashes: stashes,
        eraDepth: eraDepth
    } as ServiceArgs;
    await collectPayouts(args);
    logger.info('Close API connection.');
    await api.disconnect();
    logger.info('End payout check.');
    logger.info('------------------------------------------------------------------------------------------------');
}