/**
 * Application entry.
 */
import { startPayoutDaemon, stopPayoutDaemon } from './payout-daemon';
import yargs from 'yargs/yargs';

const argv = yargs(process.argv.slice(2))
    .options({
        daemon: { type: 'boolean', default: false },
        list: { type: 'boolean', default: false },
    })
    .parseSync();

const stop = async () => {
    await stopPayoutDaemon();
};

// SIGINT is sent for example when you Ctrl+C a running process from the command line.
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

startPayoutDaemon(argv.daemon, argv.list);
