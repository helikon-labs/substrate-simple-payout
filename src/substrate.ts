/**
 * Contains substrate functions.
 * Functions copied (or modified) from https://github.com/canontech/staking-payouts.
 */
import { ApiPromise, Keyring } from '@polkadot/api';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { keyExtractSuri, mnemonicValidate } from '@polkadot/util-crypto';
import { isHex } from '@polkadot/util';
import { logger } from './logging';
import '@polkadot/api-augment';

const SEED_LENGTHS = [12, 15, 18, 21, 24];

export interface ServiceArgs {
    api: ApiPromise;
    seedPhrase: string;
    stashAddress: string;
    eraIndex: number;
    listOnly: boolean;
}

async function getControllerAddress(api: ApiPromise, stashAddress: string) : Promise<string> {
    return (await api.query.staking.bonded(stashAddress)).toString();
}

async function payoutClaimedForAddressForEra(api: ApiPromise, stashAddress: string, eraIndex: number): Promise<boolean> {
    const controllerAddress = await getControllerAddress(api, stashAddress);
    const controllerLedger = (await api.query.staking.ledger(controllerAddress)).unwrap();
    const claimedEras = controllerLedger.claimedRewards.map(
        x => x.toNumber()
    );
    if (claimedEras.includes(eraIndex)) {
        // payout already issued
        return true;
    }
    const exposureForEra = await api.query.staking.erasStakers(eraIndex, stashAddress);
    if (!exposureForEra.total.toBn().gtn(0)) {
        // was not in the active set
        return true;
    }
    return false;
}

export async function claimPayout({
    api,
    seedPhrase,
    stashAddress,
    eraIndex,
    listOnly,
}: ServiceArgs): Promise<boolean> {
    if (await payoutClaimedForAddressForEra(api, stashAddress, eraIndex)) {
        if (!listOnly) {
            logger.info(`No payout to claim for ${stashAddress} in era ${eraIndex}`);
        }
        return false;
    } else if (listOnly) {
        logger.info(`${stashAddress} hasn't claimed payouts for era ${eraIndex}.`);
        return true;
    }
    logger.info(`Will claim payout for ${stashAddress} for era ${eraIndex}.`);
    cryptoWaitReady();
    const keyring = new Keyring({ type: 'sr25519' });
    const keypair = keyring.addFromUri(seedPhrase);
    const hash = await api.tx.staking.payoutStakers(stashAddress, eraIndex).signAndSend(keypair);
    logger.info(`Payout transaction submitted with hash ${hash}.`);
    return true;
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