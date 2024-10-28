<p align="center"><img width="65" src="https://raw.githubusercontent.com/helikon-labs/substrate-simple-payout/main/readme_files/substrate_logo_white_over_pink.png"></p>

## Substrate Simple Payout Daemon

Automated staking payout tool for substrate-based chains. Can either function in single-run mode (default), or in daemon mode, where it will run at defined periods. Supports list-only mode. A simplified and daemonized version of [canontech/staking-payouts](https://github.com/canontech/staking-payouts).

### Installation:

1. Clone the repository `git clone https://github.com/helikon-labs/substrate-simple-payout.git`.
2. Enter the source code directory `cd substrate-simple-payout`.
3. Make the `.env` file by copying the sample config file `cp .env.sample .env`.
4. Configure the parameters in the `.env` file.
    1. `SUBSTRATE_RPC_URL`: Substrate full node RPC URL.
    2. `MNEMONIC`: Mnemonic of the account that will submit the payout extrinsics.
    3. `STASHES`: Validator stash addresses for which the payouts will be made.
    4. `ERA_DEPTH`: Payout search era depth (i.e. a value of 12 means 12 eras prior to the active era will be searched for unclaimed payouts for each entered stash address).
    5. `PAYOUT_CHECK_PERIOD_MINS`: Payouts will be repeated at this period of time - expected in minutes. Ignored in the single-run mode (default).
5. Run `npm install`.
6. Run `npm start` for single-run payout mode, or `npm start -- --daemon` for the daemon mode (regular checks at defined intervals). Use the `--list` flag to only list the unclaimed eras for each stash and not make any payouts, e.g. `npm start -- --list`.
