/**
 * Contains substrate functions.
 * Functions copied or modified from https://github.com/canontech/staking-payouts.
 */
import { ApiPromise, Keyring } from '@polkadot/api';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { keyExtractSuri, mnemonicValidate } from '@polkadot/util-crypto';
import { isHex } from '@polkadot/util';
import { logger } from './logging';
import '@polkadot/api-augment';
import { KeyringPair } from '@polkadot/keyring/types';

const SEED_LENGTHS = [12, 15, 18, 21, 24];

export interface ServiceArgs {
    api: ApiPromise;
    keypair: KeyringPair,
    stashAddress: string;
    nonce: bigint;
    eraIndex: number;
    listOnly: boolean;
}

async function getPayoutPagesToClaimForAddressForEra(
    api: ApiPromise,
    stashAddress: string,
    eraIndex: number,
): Promise<Array<number> | undefined> {
    const overview = await api.query.staking.erasStakersOverview(eraIndex, stashAddress);
    if (overview.isNone) {
        // was not in the active set
        return undefined;
    }
    let pageCount = overview.unwrap().pageCount.toNumber();
    let pages = [...Array(pageCount).keys()];
    const claimedPages = (await api.query.staking.claimedRewards(eraIndex, stashAddress)).map(
        function (value) {
            return value.toNumber();
        },
    );
    let pagesToClaim = [];
    if (pages.length == 0 && claimedPages.length == 0) {
        pagesToClaim.push(0);
    } else {
        for (let i = 0; i < pages.length; i++) {
            let pageIndex = pages[i];
            if (claimedPages.indexOf(pageIndex) < 0) {
                pagesToClaim.push(pageIndex);
            }
        }
    }
    return pagesToClaim;
}

export async function claimPayout({
    api,
    keypair,
    stashAddress,
    nonce,
    eraIndex,
    listOnly,
}: ServiceArgs): Promise<bigint | undefined> {
    const pagesToClaim = await getPayoutPagesToClaimForAddressForEra(api, stashAddress, eraIndex);
    if (pagesToClaim == undefined) {
        logger.info(`${stashAddress} was not active in era ${eraIndex}.`);
        return undefined;
    }
    if (listOnly) {
        logger.info(
            `${stashAddress} has ${pagesToClaim.length} page(s) of unclaimed payouts for era ${eraIndex}.`,
        );
        return undefined;
    }
    logger.info(
        `Will claim ${pagesToClaim.length} page(s) of payout for ${stashAddress} for era ${eraIndex}.`,
    );
    cryptoWaitReady();
    
    for (let pageIndex of pagesToClaim) {
        const hash = await api.tx.staking
            .payoutStakersByPage(stashAddress, eraIndex, pageIndex)
            .signAndSend(keypair, { nonce: nonce });
        logger.info(
            `Payout transaction page ${pageIndex + 1} of ${pagesToClaim.length} submitted with hash ${hash}.`,
        );
        nonce += BigInt(1);
    }
    return nonce;
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
