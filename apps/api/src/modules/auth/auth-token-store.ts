import fs from 'node:fs';
import path from 'node:path';
import { resolveSessionsDir } from '../../config/env.js';

const ACCESS_TOKEN_MAX_REVOKE_WINDOW_MS = 24 * 60 * 60 * 1000;
const REFRESH_TOKENS_FILE = path.join(resolveSessionsDir(), 'refresh-tokens.json');
const TOKEN_REVOCATIONS_FILE = path.join(resolveSessionsDir(), 'token-revocations.json');

export const fallbackRefreshTokens = new Map<
  string,
  { userId: string; expiresAt: number; revoked: boolean }
>();

export const fallbackResetTokens = new Map<
  string,
  { userId: string; expiresAt: number; used: boolean }
>();

export const revokedAccessJtis = new Map<string, number>();
export const minUserTokenVersions = new Map<string, number>();

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

function loadTokenRevocationsFromDisk(): void {
  if (isTestRuntime()) return;
  try {
    if (!fs.existsSync(TOKEN_REVOCATIONS_FILE)) return;
    const raw = fs.readFileSync(TOKEN_REVOCATIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as {
      jtis?: Array<[string, number]>;
      userVersions?: Array<[string, number]>;
    };
    const now = Date.now();
    if (Array.isArray(parsed.jtis)) {
      for (const [jti, exp] of parsed.jtis) {
        if (typeof jti === 'string' && typeof exp === 'number' && exp > now) {
          revokedAccessJtis.set(jti, exp);
        }
      }
    }
    if (Array.isArray(parsed.userVersions)) {
      for (const [uid, ver] of parsed.userVersions) {
        if (typeof uid === 'string' && typeof ver === 'number' && ver > 1) {
          minUserTokenVersions.set(uid, ver);
        }
      }
    }
  } catch {
    void 0;
  }
}

export function persistTokenRevocationsToDisk(): void {
  if (isTestRuntime()) return;
  try {
    const dir = resolveSessionsDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const now = Date.now();
    const jtis = Array.from(revokedAccessJtis.entries()).filter(([, exp]) => exp > now);
    const userVersions = Array.from(minUserTokenVersions.entries());
    fs.writeFileSync(
      TOKEN_REVOCATIONS_FILE,
      JSON.stringify({ jtis, userVersions }),
      { encoding: 'utf8', mode: 0o600 }
    );
  } catch {
    void 0;
  }
}

function loadFallbackRefreshTokensFromDisk(): void {
  if (isTestRuntime()) return;
  try {
    if (!fs.existsSync(REFRESH_TOKENS_FILE)) return;
    const raw = fs.readFileSync(REFRESH_TOKENS_FILE, 'utf8');
    const entries = JSON.parse(raw) as Array<
      [string, { userId: string; expiresAt: number; revoked: boolean }]
    >;
    if (!Array.isArray(entries)) return;
    const now = Date.now();
    for (const [hash, record] of entries) {
      if (record && !record.revoked && record.expiresAt > now) {
        fallbackRefreshTokens.set(hash, record);
      }
    }
  } catch {
    void 0;
  }
}

export function persistFallbackRefreshTokensToDisk(): void {
  if (isTestRuntime()) return;
  try {
    const dir = resolveSessionsDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const now = Date.now();
    const activeEntries = Array.from(fallbackRefreshTokens.entries()).filter(
      ([, rec]) => !rec.revoked && rec.expiresAt > now
    );
    fs.writeFileSync(
      REFRESH_TOKENS_FILE,
      JSON.stringify(activeEntries),
      { encoding: 'utf8', mode: 0o600 }
    );
  } catch {
    void 0;
  }
}

loadTokenRevocationsFromDisk();
loadFallbackRefreshTokensFromDisk();

export function revokeAccessTokenJti(jti: string | undefined, expSeconds?: number): void {
  if (!jti) return;
  const now = Date.now();
  for (const [storedJti, expiresAt] of revokedAccessJtis.entries()) {
    if (expiresAt <= now) {
      revokedAccessJtis.delete(storedJti);
    }
  }
  const expiresAtMs = expSeconds ? expSeconds * 1000 : now + ACCESS_TOKEN_MAX_REVOKE_WINDOW_MS;
  revokedAccessJtis.set(jti, expiresAtMs);
  persistTokenRevocationsToDisk();
}
