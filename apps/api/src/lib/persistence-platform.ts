import { Prisma } from '@prisma/client';
import {
  BotLogDto,
  ConversationMessageDto
} from '@bothub/shared';
import { prisma } from './prisma.js';
import { logger } from './logger.js';
import type {
  StoredAiCredentialRecord,
  StoredAiTokenBudgetRecord,
  StoredApiKeyRecord,
  StoredOutboundWebhookRecord
} from './runtime-store.js';

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

export function isPlatformDbEnabled(forceDb = false): boolean {
  if (forceDb) {
    return true;
  }
  return (
    !isTestRuntime() &&
    typeof process.env.DATABASE_URL === 'string' &&
    process.env.DATABASE_URL.trim().length > 0
  );
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function toPrismaMessageDirection(
  senderType: ConversationMessageDto['senderType']
): 'INBOUND' | 'OUTBOUND_BOT' | 'OUTBOUND_AGENT' {
  if (senderType === 'CONTACT') {
    return 'INBOUND';
  }
  if (senderType === 'AGENT') {
    return 'OUTBOUND_AGENT';
  }
  return 'OUTBOUND_BOT';
}

export interface HydratableDbMessageRecord {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND_BOT' | 'OUTBOUND_AGENT';
  contentText: string;
  mediaUrl: string | null;
  metadataJson: unknown;
  executedNodeId: string | null;
  createdAt: Date;
}

export function mapDbMessageToDto(
  record: HydratableDbMessageRecord,
  contactDisplayName: string,
  botDisplayName: string
): ConversationMessageDto {
  const meta =
    record.metadataJson && typeof record.metadataJson === 'object'
      ? (record.metadataJson as Record<string, unknown>)
      : {};

  const rawSenderType = meta.senderType;
  const senderType: ConversationMessageDto['senderType'] =
    rawSenderType === 'CONTACT' ||
    rawSenderType === 'BOT' ||
    rawSenderType === 'AGENT' ||
    rawSenderType === 'SYSTEM'
      ? rawSenderType
      : record.direction === 'INBOUND'
        ? 'CONTACT'
        : record.direction === 'OUTBOUND_AGENT'
          ? 'AGENT'
          : 'BOT';

  const senderName =
    typeof meta.senderName === 'string' && meta.senderName.trim().length > 0
      ? meta.senderName
      : senderType === 'CONTACT'
        ? contactDisplayName
        : senderType === 'AGENT'
          ? 'Agente Chatwoot'
          : senderType === 'SYSTEM'
            ? 'BotHub Control'
            : botDisplayName;

  const rawMediaType = meta.mediaType;
  const mediaType =
    rawMediaType === 'image' || rawMediaType === 'audio' || rawMediaType === 'document'
      ? rawMediaType
      : undefined;

  const executedNodeLabel =
    typeof meta.executedNodeLabel === 'string' ? meta.executedNodeLabel : undefined;

  return {
    id: record.id,
    senderType,
    senderName,
    content: record.contentText,
    mediaUrl: record.mediaUrl ?? undefined,
    mediaType,
    executedNodeId: record.executedNodeId ?? undefined,
    executedNodeLabel,
    createdAt: record.createdAt.toISOString()
  };
}

export async function syncConversationMessagesToDb(
  conversationId: string,
  messages: ConversationMessageDto[],
  forceDb = false
): Promise<void> {
  if (!isPlatformDbEnabled(forceDb) || messages.length === 0) {
    return;
  }
  try {
    await prisma.message.createMany({
      data: messages.map((m) => ({
        id: m.id,
        conversationId,
        direction: toPrismaMessageDirection(m.senderType),
        contentType: m.mediaUrl ? (m.mediaType ?? 'media') : 'text',
        contentText: m.content,
        mediaUrl: m.mediaUrl ?? null,
        executedNodeId: m.executedNodeId ?? null,
        metadataJson: toJsonInput({
          senderType: m.senderType,
          senderName: m.senderName,
          ...(m.mediaType ? { mediaType: m.mediaType } : {}),
          ...(m.executedNodeLabel ? { executedNodeLabel: m.executedNodeLabel } : {})
        }),
        createdAt: new Date(m.createdAt)
      })),
      skipDuplicates: true
    });
  } catch (err) {
    logger.warn({ conversationId, err }, 'Failed syncing messages to PostgreSQL');
  }
}

export async function syncLogToDb(
  organizationId: string,
  entry: BotLogDto,
  forceDb = false
): Promise<void> {
  if (!isPlatformDbEnabled(forceDb)) {
    return;
  }
  try {
    const orgExists = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true }
    });
    if (!orgExists) {
      return;
    }
    await prisma.botLog.upsert({
      where: { id: entry.id },
      update: {
        level: entry.level,
        event: entry.event,
        message: entry.message,
        metadataJson: toJsonInput(entry.metadata)
      },
      create: {
        id: entry.id,
        organizationId,
        botId: entry.botId,
        level: entry.level,
        event: entry.event,
        message: entry.message,
        metadataJson: toJsonInput(entry.metadata),
        createdAt: new Date(entry.createdAt)
      }
    });
  } catch {
    void 0;
  }
}

export async function syncApiKeyToDb(
  record: StoredApiKeyRecord,
  forceDb = false
): Promise<void> {
  if (!isPlatformDbEnabled(forceDb)) {
    return;
  }
  try {
    const orgExists = await prisma.organization.findUnique({
      where: { id: record.organizationId },
      select: { id: true }
    });
    if (!orgExists) {
      return;
    }
    await prisma.apiKey.upsert({
      where: { id: record.id },
      update: {
        name: record.name,
        keyPrefix: record.keyPrefix,
        keyHash: record.keyHash,
        isActive: true
      },
      create: {
        id: record.id,
        organizationId: record.organizationId,
        name: record.name,
        keyPrefix: record.keyPrefix,
        keyHash: record.keyHash,
        isActive: true,
        createdAt: new Date(record.createdAt)
      }
    });
  } catch (err) {
    logger.warn({ apiKeyId: record.id, err }, 'Failed syncing API key to PostgreSQL');
  }
}

export async function deleteApiKeyFromDb(
  apiKeyId: string,
  organizationId: string,
  forceDb = false
): Promise<void> {
  if (!isPlatformDbEnabled(forceDb)) {
    return;
  }
  try {
    await prisma.apiKey.deleteMany({
      where: { id: apiKeyId, organizationId }
    });
  } catch (err) {
    logger.warn({ apiKeyId, err }, 'Failed deleting API key from PostgreSQL');
  }
}

export async function syncOutboundWebhookToDb(
  record: StoredOutboundWebhookRecord,
  forceDb = false
): Promise<void> {
  if (!isPlatformDbEnabled(forceDb)) {
    return;
  }
  try {
    const orgExists = await prisma.organization.findUnique({
      where: { id: record.organizationId },
      select: { id: true }
    });
    if (!orgExists) {
      return;
    }
    await prisma.webhookConfig.upsert({
      where: { id: record.id },
      update: {
        name: record.name,
        targetUrl: record.targetUrl,
        encryptedSecret: record.encryptedSecret,
        eventsJson: toJsonInput(record.events),
        isActive: record.isActive
      },
      create: {
        id: record.id,
        organizationId: record.organizationId,
        name: record.name,
        targetUrl: record.targetUrl,
        encryptedSecret: record.encryptedSecret,
        eventsJson: toJsonInput(record.events),
        isActive: record.isActive,
        createdAt: new Date(record.createdAt)
      }
    });
  } catch (err) {
    logger.warn({ webhookId: record.id, err }, 'Failed syncing outbound webhook to PostgreSQL');
  }
}

export async function deleteOutboundWebhookFromDb(
  webhookId: string,
  organizationId: string,
  forceDb = false
): Promise<void> {
  if (!isPlatformDbEnabled(forceDb)) {
    return;
  }
  try {
    await prisma.webhookConfig.deleteMany({
      where: { id: webhookId, organizationId }
    });
  } catch (err) {
    logger.warn({ webhookId, err }, 'Failed deleting outbound webhook from PostgreSQL');
  }
}

export async function syncAiCredentialToDb(
  record: StoredAiCredentialRecord,
  forceDb = false
): Promise<void> {
  if (!isPlatformDbEnabled(forceDb)) {
    return;
  }
  try {
    const orgExists = await prisma.organization.findUnique({
      where: { id: record.organizationId },
      select: { id: true }
    });
    if (!orgExists) {
      return;
    }
    await prisma.aiProviderCredential.upsert({
      where: {
        organizationId_provider: {
          organizationId: record.organizationId,
          provider: record.provider
        }
      },
      update: {
        encryptedApiKey: record.encryptedApiKey
      },
      create: {
        organizationId: record.organizationId,
        provider: record.provider,
        encryptedApiKey: record.encryptedApiKey
      }
    });
  } catch (err) {
    logger.warn(
      { organizationId: record.organizationId, provider: record.provider, err },
      'Failed syncing AI credential to PostgreSQL'
    );
  }
}

export async function deleteAiCredentialFromDb(
  organizationId: string,
  provider: string,
  forceDb = false
): Promise<void> {
  if (!isPlatformDbEnabled(forceDb)) {
    return;
  }
  try {
    await prisma.aiProviderCredential.deleteMany({
      where: { organizationId, provider }
    });
  } catch (err) {
    logger.warn(
      { organizationId, provider, err },
      'Failed deleting AI credential from PostgreSQL'
    );
  }
}

export async function syncAiTokenBudgetToDb(
  record: StoredAiTokenBudgetRecord,
  forceDb = false
): Promise<void> {
  if (!isPlatformDbEnabled(forceDb)) {
    return;
  }
  try {
    const orgExists = await prisma.organization.findUnique({
      where: { id: record.organizationId },
      select: { id: true }
    });
    if (!orgExists) {
      return;
    }
    await prisma.aiTokenBudget.upsert({
      where: { organizationId: record.organizationId },
      update: {
        monthlyLimit: record.monthlyLimit,
        tokensUsed: record.tokensUsed,
        periodKey: record.periodKey
      },
      create: {
        organizationId: record.organizationId,
        monthlyLimit: record.monthlyLimit,
        tokensUsed: record.tokensUsed,
        periodKey: record.periodKey
      }
    });
  } catch (err) {
    logger.warn(
      { organizationId: record.organizationId, err },
      'Failed syncing AI token budget to PostgreSQL'
    );
  }
}
