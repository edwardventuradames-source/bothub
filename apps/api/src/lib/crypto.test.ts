import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  generateRandomOpaqueToken,
  hashOpaqueToken,
  verifySecretConstantTime
} from './crypto.js';

describe('AES-256-GCM & Cryptographic Utilities', () => {
  const validKeyHex = crypto.randomBytes(32).toString('hex');

  it('encrypts and decrypts sensitive tokens accurately with unique IVs', () => {
    const rawCredential = 'cw_api_token_998877665544332211';
    const cipherFirst = encryptSecret(rawCredential, validKeyHex);
    const cipherSecond = encryptSecret(rawCredential, validKeyHex);

    expect(cipherFirst).not.toEqual(cipherSecond);
    expect(decryptSecret(cipherFirst, validKeyHex)).toEqual(rawCredential);
    expect(decryptSecret(cipherSecond, validKeyHex)).toEqual(rawCredential);
  });

  it('rejects tampered ciphertexts or wrong keys', () => {
    const encrypted = encryptSecret('whatsapp_session_payload', validKeyHex);
    const alternateKeyHex = crypto.randomBytes(32).toString('hex');

    expect(() => decryptSecret(encrypted, alternateKeyHex)).toThrow();
    expect(() => decryptSecret(`${encrypted}tamper`, validKeyHex)).toThrow();
  });

  it('compares secrets in constant time and hashes opaque tokens deterministically', () => {
    const token = generateRandomOpaqueToken(32);
    expect(token.length).toBe(64);
    expect(hashOpaqueToken(token)).toEqual(hashOpaqueToken(token));
    expect(verifySecretConstantTime(token, token)).toBe(true);
    expect(verifySecretConstantTime(token, 'mismatch')).toBe(false);
  });
});
