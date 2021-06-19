/**
 * Application entry.
 */
import { startPayoutDaemon, stopPayoutDaemon } from './payout-daemon';

const stop = async () => {
    await stopPayoutDaemon();
}

// SIGINT is sent for example when you Ctrl+C a running process from the command line.
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

startPayoutDaemon();