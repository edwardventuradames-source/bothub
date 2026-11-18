import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: null
});

redis.on('error', (error: Error) => {
  logger.warn({ err: error.message }, 'Redis connection warning');
});
