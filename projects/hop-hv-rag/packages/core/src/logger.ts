import { pino, type Logger } from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

const transport = isProduction
  ? undefined // Use default JSON output in production
  : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'yyyy-MM-dd HH:mm:ss',
        ignore: 'pid,hostname',
      },
    };

export const logger: Logger = pino({
  level: logLevel,
  transport,
});

export type { Logger } from 'pino';
