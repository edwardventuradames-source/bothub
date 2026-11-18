import {
  AuthenticationCreds,
  AuthenticationState,
  BufferJSON,
  initAuthCreds,
  proto,
  SignalDataTypeMap
} from 'baileys';
import { prisma } from '../../lib/prisma.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';

const CREDS_SESSION_KEY = 'creds';

async function readEncryptedRecord<T>(botId: string, sessionKey: string): Promise<T | null> {
  try {
    const record = await prisma.whatsAppSession.findUnique({
      where: {
        botId_sessionKey: {
          botId,
          sessionKey
        }
      }
    });
    if (!record) {
      return null;
    }
    const decryptedJson = decryptSecret(record.encryptedData);
    return JSON.parse(decryptedJson, BufferJSON.reviver) as T;
  } catch (error) {
    logger.warn({ botId, sessionKey, err: error }, 'Failed reading encrypted WhatsApp session key');
    return null;
  }
}

async function writeEncryptedRecord(
  botId: string,
  sessionKey: string,
  data: unknown
): Promise<void> {
  try {
    const serialized = JSON.stringify(data, BufferJSON.replacer);
    const encryptedData = encryptSecret(serialized);
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
  } catch (error) {
    logger.warn({ botId, sessionKey, err: error }, 'Failed persisting encrypted WhatsApp session key');
  }
}

async function removeEncryptedRecord(botId: string, sessionKey: string): Promise<void> {
  try {
    await prisma.whatsAppSession.deleteMany({
      where: {
        botId,
        sessionKey
      }
    });
  } catch (error) {
    logger.warn({ botId, sessionKey, err: error }, 'Failed deleting WhatsApp session key');
  }
}

export async function clearAllEncryptedBotSessions(botId: string): Promise<void> {
  try {
    await prisma.whatsAppSession.deleteMany({
      where: { botId }
    });
  } catch (error) {
    logger.warn({ botId, err: error }, 'Failed clearing all WhatsApp session keys for bot');
  }
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
