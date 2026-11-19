import fs from 'node:fs';
import path from 'node:path';
import {
  AuthenticationCreds,
  AuthenticationState,
  BufferJSON,
  initAuthCreds,
  proto,
  SignalDataTypeMap
} from 'baileys';
import { resolveSessionsDir } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { isDatabaseConfigured } from '../../lib/persistence.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';

const CREDS_SESSION_KEY = 'creds';
const BAILEYS_DISK_DIR = path.join(resolveSessionsDir(), 'baileys');

const fileWriteQueues = new Map<string, Promise<void>>();

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

function getDiskSessionFile(botId: string): string {
  const safeId = botId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(BAILEYS_DISK_DIR, `${safeId}.enc.json`);
}

function enqueueDiskWrite(botId: string, task: () => Promise<void>): Promise<void> {
  const previous = fileWriteQueues.get(botId) ?? Promise.resolve();
  const next = previous.then(task).catch((err) => {
    logger.warn({ botId, err }, 'Baileys disk auth state write failed');
  });
  fileWriteQueues.set(botId, next);
  return next;
}

function readDiskSessionMap(botId: string): Record<string, string> {
  if (isTestRuntime()) return {};
  try {
    const filePath = getDiskSessionFile(botId);
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeDiskSessionMap(botId: string, map: Record<string, string>): void {
  if (isTestRuntime()) return;
  if (!fs.existsSync(BAILEYS_DISK_DIR)) {
    fs.mkdirSync(BAILEYS_DISK_DIR, { recursive: true });
  }
  fs.writeFileSync(getDiskSessionFile(botId), JSON.stringify(map), 'utf8');
}

export async function hasPersistedBotSession(botId: string): Promise<boolean> {
  if (isDatabaseConfigured()) {
    try {
      const count = await prisma.whatsAppSession.count({ where: { botId } });
      if (count > 0) return true;
    } catch {
      void 0;
    }
  }
  const diskMap = readDiskSessionMap(botId);
  return typeof diskMap[CREDS_SESSION_KEY] === 'string';
}

async function readEncryptedRecord<T>(botId: string, sessionKey: string): Promise<T | null> {
  if (isDatabaseConfigured()) {
    try {
      const record = await prisma.whatsAppSession.findUnique({
        where: {
          botId_sessionKey: {
            botId,
            sessionKey
          }
        }
      });
      if (record) {
        const decryptedJson = decryptSecret(record.encryptedData);
        return JSON.parse(decryptedJson, BufferJSON.reviver) as T;
      }
    } catch (error) {
      logger.warn({ botId, sessionKey, err: error }, 'Failed reading DB WhatsApp session key');
    }
  }

  try {
    const diskMap = readDiskSessionMap(botId);
    const encrypted = diskMap[sessionKey];
    if (!encrypted) return null;
    const decryptedJson = decryptSecret(encrypted);
    return JSON.parse(decryptedJson, BufferJSON.reviver) as T;
  } catch {
    return null;
  }
}

async function writeEncryptedRecord(
  botId: string,
  sessionKey: string,
  data: unknown
): Promise<void> {
  const serialized = JSON.stringify(data, BufferJSON.replacer);
  const encryptedData = encryptSecret(serialized);

  if (isDatabaseConfigured()) {
    try {
      await prisma.whatsAppSession.upsert({
        where: {
          botId_sessionKey: {
            botId,
            sessionKey
          }
        },
        update: { encryptedData },
        create: {
          botId,
          sessionKey,
          encryptedData
        }
      });
      return;
    } catch (error) {
      logger.warn({ botId, sessionKey, err: error }, 'Failed persisting DB WhatsApp session key');
    }
  }

  await enqueueDiskWrite(botId, async () => {
    const map = readDiskSessionMap(botId);
    map[sessionKey] = encryptedData;
    writeDiskSessionMap(botId, map);
  });
}

async function removeEncryptedRecord(botId: string, sessionKey: string): Promise<void> {
  if (isDatabaseConfigured()) {
    try {
      await prisma.whatsAppSession.deleteMany({
        where: {
          botId,
          sessionKey
        }
      });
      return;
    } catch (error) {
      logger.warn({ botId, sessionKey, err: error }, 'Failed deleting DB WhatsApp session key');
    }
  }

  await enqueueDiskWrite(botId, async () => {
    const map = readDiskSessionMap(botId);
    delete map[sessionKey];
    writeDiskSessionMap(botId, map);
  });
}

export async function clearAllEncryptedBotSessions(botId: string): Promise<void> {
  if (isDatabaseConfigured()) {
    try {
      await prisma.whatsAppSession.deleteMany({
        where: { botId }
      });
    } catch (error) {
      logger.warn({ botId, err: error }, 'Failed clearing DB WhatsApp session keys');
    }
  }

  await enqueueDiskWrite(botId, async () => {
    const filePath = getDiskSessionFile(botId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
}

export async function usePrismaEncryptedAuthState(botId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const existingCreds = await readEncryptedRecord<AuthenticationCreds>(botId, CREDS_SESSION_KEY);
  const creds: AuthenticationCreds = existingCreds ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              const compositeKey = `${String(type)}-${id}`;
              let value = await readEncryptedRecord<SignalDataTypeMap[T]>(botId, compositeKey);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(
                  value as unknown as Record<string, unknown>
                ) as unknown as SignalDataTypeMap[T];
              }
              if (value) {
                data[id] = value;
              }
            })
          );
          return data;
        },
        set: async (data: Record<string, Record<string, unknown>>) => {
          const operations: Promise<void>[] = [];
          for (const category of Object.keys(data)) {
            const categoryEntries = data[category];
            if (!categoryEntries) {
              continue;
            }
            for (const id of Object.keys(categoryEntries)) {
              const value = categoryEntries[id];
              const compositeKey = `${category}-${id}`;
              if (value) {
                operations.push(writeEncryptedRecord(botId, compositeKey, value));
              } else {
                operations.push(removeEncryptedRecord(botId, compositeKey));
              }
            }
          }
          await Promise.all(operations);
        }
      }
    },
    saveCreds: async () => {
      await writeEncryptedRecord(botId, CREDS_SESSION_KEY, creds);
    }
  };
}
