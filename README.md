<p align="center"><img width="65" src="https://raw.githubusercontent.com/helikon-labs/substrate-payout-daemon/main/readme_files/substrate_logo_white_over_pink.png"></p>

## Substrate Payout Daemon

Automated staking payout daemon for subsrate-based chains. Substrate module functions mostly taken from the [canontech/staking-payouts](https://github.com/canontech/staking-payouts) repository with minor modifications.

### Installation:

1. Clone the repository `git clone https://github.com/helikon-labs/substrate-payout-daemon.git`.
2. Enter the source code directory `cd substrate-payout-daemon`.
3. Make the `.env` file by copying the sample config file `cp .env.sample .env`.
4. Configure the parameters in the `.env` file.
    1. `SUBSTRATE_RPC_URL`: Substrate full node RPC URL.
    2. `MNEMONIC`: Mnemonic of the account that will submit the payout extrinsics.
    3. `STASHES`: Validator stash addresses for which the payouts will be made. You can also enter nominator addresses, and the payouts will be made for their target validators.
    4. `ERA_DEPTH`: Payout search era depth (i.e. a value of 12 means 12 eras prior to the active era will be searched for unclaimed payouts for each entered stash address).
    5. `PAYOUT_CHECK_PERIOD_MINS`: Payouts will be repeated at this period of time - expected in minutes.
5. Run `npm install`.
6. Run `npm start`. Alternatively you can setup a `systemd` service.