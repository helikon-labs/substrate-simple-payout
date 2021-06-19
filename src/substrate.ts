/**
 * Contains substrate functions.
 * Functions copied (or modified) from https://github.com/canontech/staking-payouts.
 */
import { ApiPromise, Keyring } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/submittable/types';
import { Codec, ISubmittableResult } from '@polkadot/types/types';
import { Vec } from '@polkadot/types/codec';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { keyExtractSuri, mnemonicValidate } from '@polkadot/util-crypto';
import { isHex } from '@polkadot/util';

import { logger } from './logging';

const MAX_CALLS = 9;
const SEED_LENGTHS = [12, 15, 18, 21, 24];

export interface ServiceArgs {
    api: ApiPromise;
    suri: string;
    stashes: string[];
    eraDepth: number;
}

async function isValidatingInEra(
    api: ApiPromise,
    stash: string,
    eraToCheck: number
): Promise<boolean> {
    try {
        const exposure = await api.query.staking.erasStakers(eraToCheck, stash);
        // If their total exposure is greater than 0 they are validating in the era.
        return exposure.total.toBn().gtn(0);
    } catch {
        return false;
    }
}

export async function collectPayouts({
    api,
    suri,
    stashes,
    eraDepth,
}: ServiceArgs): Promise<void> {
    const payouts = await listPendingPayouts({
        stashes,
        eraDepth,
        api,
    });

    if (!payouts || !payouts.length) {
        logger.info('No payouts to claim');
        return;
    }

    logger.info(
        `Transactions are being created. This may take some time if there are many unclaimed eras.`
    );

    await signAndSendTxs(api, payouts, suri);
}

async function listPendingPayouts(
    {
        api,
        stashes,
        eraDepth,
    }: Omit<ServiceArgs, 'suri'>
): Promise<SubmittableExtrinsic<'promise', ISubmittableResult>[] | null> {
    const activeEraOpt = await api.query.staking.activeEra();
    if (activeEraOpt.isNone) {
        logger.warn('ActiveEra is None, pending payouts could not be fetched.');
        return null;
    }
    const currEra = activeEraOpt.unwrap().index.toNumber();

    // get all the validator addresses to get payouts for
    const validatorStashes = [];
    for (const stash of stashes) {
        const maybeNominations = await api.query.staking.nominators(stash);
        if (maybeNominations.isSome) {
            const targets = maybeNominations.unwrap().targets.map((a) => a.toHuman());
            logger.info(
                `Nominator address detected: ${stash}. Adding its targets: ${targets.join(
                    ', '
                )}`
            );
            validatorStashes.push(...targets);
        } else {
            logger.info(`Validator address detected: ${stash}`);
            validatorStashes.push(stash);
        }
    }

    // get pending payouts for the validator addresses
    const payouts = [];
    for (const stash of validatorStashes) {
        const controllerOpt = await api.query.staking.bonded(stash);
        if (controllerOpt.isNone) {
            logger.warn(`${stash} is not a valid stash address.`);
            continue;
        }

        const controller = controllerOpt.unwrap();
        // Get payouts for a validator
        const ledgerOpt = await api.query.staking.ledger(controller);
        if (ledgerOpt.isNone) {
            logger.warn(`Staking ledger for ${stash} was not found.`);
            continue;
        }
        const ledger = ledgerOpt.unwrap();

        const { claimedRewards } = ledger;

        const lastEra = claimedRewards[claimedRewards.length - 1]?.toNumber();
        if (!lastEra) {
            // this shouldn't happen but here anyways
            continue;
        }
        // see if there are any gaps in eras we have not claimed but should
        for (let e = lastEra - eraDepth; e < lastEra; e += 1) {
            if (claimedRewards.includes(e)) {
                continue;
            }

            // check they nominated that era
            if (await isValidatingInEra(api, stash, e)) {
                const payoutStakes = api.tx.staking.payoutStakers(stash, e);
                payouts.push(payoutStakes);
            }
        }

        // check from the last collected era up until current
        for (let e = lastEra + 1; e < currEra; e += 1) {
            if (await isValidatingInEra(api, stash, e)) {
                // Get payouts for each era where payouts have not been claimed
                const payoutStakes = api.tx.staking.payoutStakers(stash, e);
                payouts.push(payoutStakes);
            }
        }
    }

    payouts.length &&
        logger.info(
            `The following unclaimed payouts where found: \n${payouts
                .map(
                    ({ method: { section, method, args } }) =>
                        `${section}.${method}(${
                            args.map ? args.map((a) => `${a.toHuman()}`).join(', ') : args
                        })`
                )
                .join('\n')}`
        ) &&
        logger.info(`Total of ${payouts.length} unclaimed payouts.`);

    return payouts;
}

async function signAndSendTxs(
    api: ApiPromise,
    payouts: SubmittableExtrinsic<'promise', ISubmittableResult>[],
    suri: string
) {
    await cryptoWaitReady();
    const keyring = new Keyring();
    const signingKeys = keyring.createFromUri(suri, {}, 'sr25519');

    logger.info(
        `Sender address: ${keyring.encodeAddress(
            signingKeys.address,
            api.registry.chainSS58
        )}`
    );

    const { maxExtrinsic } = api.consts.system.blockWeights.perClass.normal;
    // Assume most of the time we want batches of size 8. Below we check if that is
    // too big, and if it is we reduce the number of calls in each batch until it is
    // below the max allowed weight.
    // Note: 8 may need to be adjusted in the future - can look into adding a CLI flag.
    const byMaxCalls = payouts.reduce((byMaxCalls, tx, idx) => {
        if (idx % MAX_CALLS === 0) {
            byMaxCalls.push([]);
        }
        byMaxCalls[byMaxCalls.length - 1].push(tx);

        return byMaxCalls;
    }, [] as SubmittableExtrinsic<'promise'>[][]);

    // We will create multiple transactions if the batch is too big.
    const txs = [];
    while (byMaxCalls.length) {
        const calls = byMaxCalls.shift();
        if (!calls) {
            // Shouldn't be possible, but this makes tsc happy
            break;
        }

        let tooHeavy = true;
        while (tooHeavy) {
            const batch = api.tx.utility.batch(calls);
            const { weight } = await batch.paymentInfo(signingKeys);
            if (weight.muln(batch.length).gte(maxExtrinsic)) {
                // Remove a call from the batch since it will get rejected for exhausting resources.
                const removeTx = calls.pop();
                if (!removeTx) {
                    // `removeTx` is undefined, which shouldn't happen and means we can't even
                    // fit one call into a batch.
                    tooHeavy = false;
                } else if (
                    !byMaxCalls[byMaxCalls.length - 1] ||
                    byMaxCalls[byMaxCalls.length - 1].length >= MAX_CALLS
                ) {
                    // There is either no subarray of txs left OR the subarray at the front is greater
                    // then the max size we want, so we create a new subarray.
                    byMaxCalls.push([removeTx]);
                } else {
                    // Add the removed tx to the last subarray, which at this point only has
                    // other remvoed txs.
                    byMaxCalls[byMaxCalls.length - 1].push(removeTx);
                }
            } else {
                tooHeavy = false;
            }
        }

        if (calls.length == 1) {
            txs.push(calls[0]);
        } else if (calls.length > 1) {
            txs.push(api.tx.utility.batch(calls));
        }
    }

    logger.info(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
        `Calls per tx ${txs
            .map((t) =>
                t.method.method.toLowerCase() == 'batch'
                    ? (t.args[0] as Vec<Codec>).length
                    : 1
            )
            .toString()}`
    );

    // Send all the transactions
    logger.info(`Getting ready to send ${txs.length} transactions.`);
    for (const [i, tx] of txs.entries()) {
        logger.info(
            `Sending ${tx.method.section}.${tx.method.method} (tx ${i + 1}/${
                txs.length
            })`
        );

        tx.method.method.toLowerCase() === 'batch' &&
        logger.info(
            `${tx.method.section}.${tx.method.method} has ${
                (tx.method.args[0] as unknown as [])?.length
            } calls`
        );

        try {
            const res = await tx.signAndSend(signingKeys, { nonce: -1 });
            logger.info(`Node response to tx: ${res.toString()}`);
        } catch (e) {
            logger.error(`Tx failed to sign and send (tx ${i + 1}/${txs.length})`);
            logger.error(e);
        }
    }
}

export function isValidSeed(suri: string): boolean {
    const { phrase } = keyExtractSuri(suri);

    if (isHex(phrase)) {
        if (!isHex(phrase, 256)) {
            logger.error('Hex seed needs to be 256-bits');
            return false;
        }
    } else {
        if (!SEED_LENGTHS.includes((phrase as string).split(' ').length)) {
            logger.error(`Mnemonic needs to contain ${SEED_LENGTHS.join(', ')} words`);
            return false;
        }

        if (!mnemonicValidate(phrase)) {
            logger.error('Not a valid mnemonic seed');
            return false;
        }
    }

    return true;
}