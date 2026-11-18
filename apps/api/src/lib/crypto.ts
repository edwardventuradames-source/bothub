import crypto from 'node:crypto';
import { env } from '../config/env.js';

const AES_ALGORITHM = 'aes-256-gcm';
const IV_BYTE_LENGTH = 12;
const AUTH_TAG_BYTE_LENGTH = 16;
const KEY_BYTE_LENGTH = 32;
const DEFAULT_TOKEN_BYTES = 32;
const PAYLOAD_SEPARATOR = ':';
const EXPECTED_PAYLOAD_PARTS = 3;

function resolveEncryptionKey(customKeyHex?: string): Buffer {
  const keyHex = customKeyHex ?? env.ENCRYPTION_KEY_HEX;
  const keyBuffer = Buffer.from(keyHex, 'hex');
  if (keyBuffer.length !== KEY_BYTE_LENGTH) {
    throw new Error('Encryption key must be exactly 32 bytes (64 hex characters)');
  }
  return keyBuffer;
}

export function encryptSecret(plainText: string, customKeyHex?: string): string {
  const key = resolveEncryptionKey(customKeyHex);
  const iv = crypto.randomBytes(IV_BYTE_LENGTH);
  const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTE_LENGTH
  });

  const encryptedBuffer = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encryptedBuffer.toString('base64')
  ].join(PAYLOAD_SEPARATOR);
}

export function decryptSecret(encryptedPayload: string, customKeyHex?: string): string {
  const parts = encryptedPayload.split(PAYLOAD_SEPARATOR);
  if (parts.length !== EXPECTED_PAYLOAD_PARTS) {
    throw new Error('Malformed encrypted payload');
  }

  const [ivBase64, authTagBase64, cipherTextBase64] = parts;
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const cipherText = Buffer.from(cipherTextBase64, 'base64');

  if (iv.length !== IV_BYTE_LENGTH || authTag.length !== AUTH_TAG_BYTE_LENGTH) {
    throw new Error('Invalid initialization vector or authentication tag length');
  }

  const key = resolveEncryptionKey(customKeyHex);
  const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTE_LENGTH
  });
  decipher.setAuthTag(authTag);

  const decryptedBuffer = Buffer.concat([
    decipher.update(cipherText),
    decipher.final()
  ]);

  return decryptedBuffer.toString('utf8');
}

export function generateRandomOpaqueToken(byteLength = DEFAULT_TOKEN_BYTES): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

export function hashOpaqueToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function verifySecretConstantTime(candidate: string, expected: string): boolean {
  const candidateDigest = crypto.createHash('sha256').update(candidate, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  const digestsMatch = crypto.timingSafeEqual(candidateDigest, expectedDigest);
  return digestsMatch && candidate.length === expected.length;
}
