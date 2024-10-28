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

const SEED_LENGTHS = [12, 15, 18, 21, 24];

export interface ServiceArgs {
    api: ApiPromise;
    seedPhrase: string;
    stashAddress: string;
    eraIndex: number;
    listOnly: boolean;
}

async function getPayoutPagesToClaimForAddressForEra(
    api: ApiPromise,
    stashAddress: string,
    eraIndex: number,
): Promise<Array<number>> {
    const overview = await api.query.staking.erasStakersOverview(eraIndex, stashAddress);
    if (overview.isNone) {
        // was not in the active set
        return [];
    }
    let pageCount = overview.unwrap().pageCount.toNumber();
    let pages = [...Array(pageCount).keys()];
    const claimedPages = (await api.query.staking.claimedRewards(eraIndex, stashAddress)).map(
        function (value) {
            return value.toNumber();
        },
    );
    let pagesToClaim = [];
    for (let i = 0; i < pages.length; i++) {
        let pageIndex = pages[i];
        if (claimedPages.indexOf(pageIndex) < 0) {
            pagesToClaim.push(pageIndex);
        }
    }
    return pagesToClaim;
}

export async function claimPayout({
    api,
    seedPhrase,
    stashAddress,
    eraIndex,
    listOnly,
}: ServiceArgs): Promise<boolean> {
    const pagesToClaim = await getPayoutPagesToClaimForAddressForEra(api, stashAddress, eraIndex);
    if (pagesToClaim.length == 0) {
        logger.info(`No payout to claim for ${stashAddress} in era ${eraIndex}`);
        return false;
    }
    if (listOnly) {
        logger.info(
            `${stashAddress} has ${pagesToClaim.length} pages of unclaimed payouts for era ${eraIndex}.`,
        );
        return true;
    }
    logger.info(
        `Will claim ${pagesToClaim.length} pages of payout for ${stashAddress} for era ${eraIndex}.`,
    );
    cryptoWaitReady();
    const keyring = new Keyring({ type: 'sr25519' });
    const keypair = keyring.addFromUri(seedPhrase);
    for (let pageIndex of pagesToClaim) {
        const hash = await api.tx.staking
            .payoutStakersByPage(stashAddress, eraIndex, pageIndex)
            .signAndSend(keypair, { nonce: -1 });
        logger.info(
            `Payout transaction page ${pageIndex + 1} of ${pagesToClaim.length} submitted with hash ${hash}.`,
        );
    }
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
