import crypto from 'node:crypto';
import { z } from 'zod';

const DEFAULT_PORT = 4000;
const EPHEMERAL_KEY_BYTES = 32;

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('postgresql://localhost:5432/bothub'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32)
    .default(() => crypto.randomBytes(EPHEMERAL_KEY_BYTES).toString('hex')),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32)
    .default(() => crypto.randomBytes(EPHEMERAL_KEY_BYTES).toString('hex')),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY_HEX: z
    .string()
    .length(64)
    .default(() => crypto.randomBytes(EPHEMERAL_KEY_BYTES).toString('hex'))
});

const parsedEnv = EnvSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  DATABASE_URL: process.env.DATABASE_URL || undefined,
  REDIS_URL: process.env.REDIS_URL || undefined,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || undefined,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || undefined,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || undefined,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || undefined,
  ENCRYPTION_KEY_HEX: process.env.ENCRYPTION_KEY_HEX || undefined
});

if (!parsedEnv.success) {
  throw new Error(`Invalid environment configuration: ${parsedEnv.error.message}`);
}

export const env = parsedEnv.data;
