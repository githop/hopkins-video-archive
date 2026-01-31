import { pino, type Logger as PinoLogger } from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

const transport = isProduction
  ? undefined // Use default JSON output in production
  : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
      },
    };

const pinoInstance = pino({
  level: logLevel,
  transport,
});

export type Logger = PinoLogger & {
  print: (message: string, ...args: any[]) => void;
};

export const logger = Object.assign(pinoInstance, {
  print: (message: string, ...args: any[]) => {
    // eslint-disable-next-line no-console
    console.log(message, ...args);
  },
}) as Logger;
