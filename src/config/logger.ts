import winston from 'winston';
import { env } from './env.js';

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  transports: [new winston.transports.Console({ format: winston.format.simple() })],
});
