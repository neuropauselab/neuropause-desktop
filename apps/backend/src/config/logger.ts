import pino from 'pino';
import { loadEnv } from './env';

const isDev = loadEnv().NODE_ENV === 'development';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  redact: {
    paths: ['req.headers.authorization', 'password', '*.password', 'refreshToken', 'accessToken'],
    censor: '[redacted]',
  },
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
});
