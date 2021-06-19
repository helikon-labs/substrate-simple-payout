/**
 * Contains the logger.
 */
import { createLogger, format, transports } from 'winston';

const myFormat = format.printf(({ level, message, label, timestamp }) => {
	return `${timestamp} ${level.toUpperCase()}\t${message}`;
});

export const logger = createLogger({
	level: 'debug',
    format: format.combine(
        format.timestamp(),
		format.errors({ stack: true }),
		myFormat
	),
	transports: [new transports.Console()],
});