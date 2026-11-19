import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const DEFAULT_PORT = 4000;
const EPHEMERAL_KEY_BYTES = 32;

export function resolveSessionsDir(): string {
  if (process.env.SESSIONS_DIR) {
    return path.resolve(process.env.SESSIONS_DIR);
  }
  const monorepoApiDir = path.resolve(process.cwd(), 'apps/api');
  if (fs.existsSync(monorepoApiDir)) {
    return path.join(monorepoApiDir, 'sessions');
  }
  return path.resolve(process.cwd(), 'sessions');
}

const SESSIONS_DIR = resolveSessionsDir();
const SERVER_SECRETS_FILE = path.join(SESSIONS_DIR, 'server-secrets.json');

interface PersistedServerSecrets {
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  encryptionKeyHex: string;
}

function loadOrCreatePersistedSecrets(): PersistedServerSecrets {
  const isTestEnv =
    process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

  if (!isTestEnv) {
    try {
      if (fs.existsSync(SERVER_SECRETS_FILE)) {
        const raw = fs.readFileSync(SERVER_SECRETS_FILE, 'utf8');
        const parsed = JSON.parse(raw) as Partial<PersistedServerSecrets>;
        if (
          typeof parsed.jwtAccessSecret === 'string' &&
          parsed.jwtAccessSecret.length >= 32 &&
          typeof parsed.jwtRefreshSecret === 'string' &&
          parsed.jwtRefreshSecret.length >= 32 &&
          typeof parsed.encryptionKeyHex === 'string' &&
          parsed.encryptionKeyHex.length === 64
        ) {
          return {
            jwtAccessSecret: parsed.jwtAccessSecret,
            jwtRefreshSecret: parsed.jwtRefreshSecret,
            encryptionKeyHex: parsed.encryptionKeyHex
          };
        }
      }
    } catch {
      void 0;
    }
  }

  const generated: PersistedServerSecrets = {
    jwtAccessSecret: crypto.randomBytes(EPHEMERAL_KEY_BYTES).toString('hex'),
    jwtRefreshSecret: crypto.randomBytes(EPHEMERAL_KEY_BYTES).toString('hex'),
    encryptionKeyHex: crypto.randomBytes(EPHEMERAL_KEY_BYTES).toString('hex')
  };

  if (!isTestEnv) {
    try {
      if (!fs.existsSync(SESSIONS_DIR)) {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      }
      fs.writeFileSync(
        SERVER_SECRETS_FILE,
        JSON.stringify(generated, null, 2),
        { encoding: 'utf8', mode: 0o600 }
      );
    } catch {
      void 0;
    }
  }

  return generated;
}

const persistedSecrets = loadOrCreatePersistedSecrets();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('postgresql://localhost:5432/bothub'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32)
    .default(persistedSecrets.jwtAccessSecret),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32)
    .default(persistedSecrets.jwtRefreshSecret),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY_HEX: z
    .string()
    .length(64)
    .default(persistedSecrets.encryptionKeyHex)
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
