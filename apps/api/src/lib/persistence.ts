import { Prisma } from '@prisma/client';
import {
  BotConnectionStatus,
  BotDto,
  BotLogDto,
  BusinessHoursDay,
  ContactDto,
  ConversationDto,
  ConversationMessageDto,
  ConversationStatus,
  FlowDto,
  FlowEdge,
  FlowExecutionStepLog,
  FlowNode,
  FlowVersionDto,
  WhatsAppDriverType
} from '@bothub/shared';
import { prisma } from './prisma.js';
import { redis } from './redis.js';
import { logger } from './logger.js';
import { createDefaultBusinessHours } from './runtime-seed-graphs.js';
import {
  StoredChatwootSecrets,
  StoredCloudApiSecrets,
  maskSecretValue
} from './runtime-store.js';
import { decryptSecret } from './crypto.js';

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

export function isDatabaseConfigured(): boolean {
  return (
    !isTestRuntime() &&
    typeof process.env.DATABASE_URL === 'string' &&
    process.env.DATABASE_URL.trim().length > 0
  );
}

function mapPrismaConversationStatus(
  prismaStatus: string,
  sessionState: Record<string, unknown>
): ConversationStatus {
  if (
    sessionState.uiStatus === 'PENDING_AGENT' ||
    sessionState.uiStatus === 'AGENT_ACTIVE' ||
    sessionState.uiStatus === 'BOT_ACTIVE' ||
    sessionState.uiStatus === 'RESOLVED'
  ) {
    return sessionState.uiStatus;
  }
  if (prismaStatus === 'HANDOFF_OPEN') return 'PENDING_AGENT';
  if (prismaStatus === 'CLOSED') return 'RESOLVED';
  return 'BOT_ACTIVE';
}

function toPrismaConversationStatus(
  status: ConversationStatus
): 'BOT_ACTIVE' | 'HANDOFF_OPEN' | 'CLOSED' {
  if (status === 'PENDING_AGENT' || status === 'AGENT_ACTIVE') {
    return 'HANDOFF_OPEN';
  }
  if (status === 'RESOLVED') {
    return 'CLOSED';
  }
  return 'BOT_ACTIVE';
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function initializeRedisIfConfigured(): Promise<void> {
  if (isTestRuntime() || !process.env.REDIS_URL?.trim()) {
    return;
  }
  try {
    if (redis.status === 'wait') {
      await redis.connect();
    }
    await redis.ping();
    logger.info('Redis connection verified');
  } catch (err) {
    logger.warn({ err }, 'Redis unavailable; continuing with local memory coordination');
  }
}

export async function hydrateStoreFromDatabase(target: {
  bots: BotDto[];
  chatwootSecrets: Map<string, StoredChatwootSecrets>;
  cloudApiSecrets: Map<string, StoredCloudApiSecrets>;
  flows: FlowDto[];
  contacts: ContactDto[];
  conversations: ConversationDto[];
  logs: BotLogDto[];
}): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    return false;
  }

  try {
    const dbBots = await prisma.bot.findMany({
      include: {
        chatwootConfig: true,
        businessHours: true,
        quickReplies: true,
        flows: {
          include: {
            versions: {
              orderBy: { versionNumber: 'desc' },
              take: 25
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (dbBots.length === 0) {
      return false;
    }

    const hydratedBots: BotDto[] = [];
    const hydratedFlows: FlowDto[] = [];

    for (const dbBot of dbBots) {
      let chatwootDto: BotDto['chatwootConfig'] = null;
      if (dbBot.chatwootConfig) {
        const cw = dbBot.chatwootConfig;
        target.chatwootSecrets.set(dbBot.id, {
          baseUrl: cw.baseUrl,
          accountId: cw.accountId,
          inboxId: cw.inboxId,
          encryptedApiAccessToken: cw.encryptedApiAccessToken,
          encryptedWebhookToken: cw.encryptedWebhookToken,
          handoffReturnCommand: cw.handoffReturnCommand,
          isActive: cw.isConnected,
          lastSyncedAt: cw.lastVerifiedAt ? cw.lastVerifiedAt.toISOString() : null
        });
        const rawApi = decryptSecret(cw.encryptedApiAccessToken);
        const rawWh = decryptSecret(cw.encryptedWebhookToken);
        chatwootDto = {
          baseUrl: cw.baseUrl,
          accountId: cw.accountId,
          inboxId: cw.inboxId,
          hasApiAccessToken: rawApi.length > 0,
          maskedApiAccessToken: maskSecretValue(rawApi),
          webhookTokenPreview: maskSecretValue(rawWh),
          webhookEndpointPath: rawWh
            ? `/api/webhooks/chatwoot/${dbBot.id}?token=${encodeURIComponent(rawWh)}`
            : `/api/webhooks/chatwoot/${dbBot.id}`,
          handoffReturnCommand: cw.handoffReturnCommand,
          isActive: cw.isConnected,
          lastSyncedAt: cw.lastVerifiedAt ? cw.lastVerifiedAt.toISOString() : null
        };
      }

      let cloudApiDto: BotDto['cloudApiConfig'] = null;
      if (dbBot.cloudApiEncryptedConfig) {
        try {
          const parsedSecrets = JSON.parse(
            dbBot.cloudApiEncryptedConfig
          ) as StoredCloudApiSecrets;
          if (parsedSecrets.phoneNumberId && parsedSecrets.encryptedAccessToken) {
            target.cloudApiSecrets.set(dbBot.id, parsedSecrets);
            const rawAccess = decryptSecret(parsedSecrets.encryptedAccessToken);
            const rawVerify = decryptSecret(parsedSecrets.encryptedVerifyToken);
            cloudApiDto = {
              phoneNumberId: parsedSecrets.phoneNumberId,
              wabaId: parsedSecrets.wabaId,
              hasAccessToken: rawAccess.length > 0,
              hasAppSecret: Boolean(parsedSecrets.encryptedAppSecret),
              maskedAccessToken: maskSecretValue(rawAccess),
              verifyTokenPreview: maskSecretValue(rawVerify),
              webhookPath: `/api/webhooks/whatsapp-cloud/${dbBot.id}`
            };
          }
        } catch {
          void 0;
        }
      }

      const mainFlow = dbBot.flows.find((f) => f.isMainMenu) ?? dbBot.flows[0] ?? null;

      for (const dbFlow of dbBot.flows) {
        const draftVersion: FlowVersionDto = {
          id: `fv-${dbFlow.id}-draft`,
          versionNumber: Math.max(dbFlow.publishedVersion, 1),
          status: 'DRAFT',
          nodes: (dbFlow.draftNodes as unknown as FlowNode[]) ?? [],
          edges: (dbFlow.draftEdges as unknown as FlowEdge[]) ?? [],
          publishedAt: null,
          createdAt: dbFlow.updatedAt.toISOString()
        };

        const publishedVersion: FlowVersionDto | null =
          dbFlow.publishedNodes && dbFlow.publishedEdges
            ? {
                id: `fv-${dbFlow.id}-pub`,
                versionNumber: Math.max(dbFlow.publishedVersion, 1),
                status: 'PUBLISHED',
                nodes: dbFlow.publishedNodes as unknown as FlowNode[],
                edges: dbFlow.publishedEdges as unknown as FlowEdge[],
                publishedAt: dbFlow.updatedAt.toISOString(),
                createdAt: dbFlow.updatedAt.toISOString()
              }
            : null;

        const versions: FlowVersionDto[] = dbFlow.versions.map((ver) => ({
          id: ver.id,
          versionNumber: ver.versionNumber,
          status: ver.versionNumber === dbFlow.publishedVersion ? 'PUBLISHED' : 'DRAFT',
          nodes: (ver.nodes as unknown as FlowNode[]) ?? [],
          edges: (ver.edges as unknown as FlowEdge[]) ?? [],
          publishedAt:
            ver.versionNumber === dbFlow.publishedVersion
              ? ver.createdAt.toISOString()
              : null,
          createdAt: ver.createdAt.toISOString()
        }));

        hydratedFlows.push({
          id: dbFlow.id,
          organizationId: dbBot.organizationId,
          name: dbFlow.name,
          description: dbFlow.description ?? '',
          botId: dbBot.id,
          botName: dbBot.name,
          isMainMenu: dbFlow.isMainMenu,
          activeVersionNumber: Math.max(dbFlow.publishedVersion, 1),
          draftVersion,
          publishedVersion,
          versions: versions.length > 0 ? versions : [draftVersion],
          createdAt: dbFlow.createdAt.toISOString(),
          updatedAt: dbFlow.updatedAt.toISOString()
        });
      }

      const scheduleDays = Array.isArray(dbBot.businessHours?.scheduleJson)
        ? (dbBot.businessHours.scheduleJson as unknown as BusinessHoursDay[])
        : createDefaultBusinessHours();

      hydratedBots.push({
        id: dbBot.id,
        organizationId: dbBot.organizationId,
        name: dbBot.name,
        description: dbBot.description ?? '',
        phoneNumber: dbBot.phoneNumber ?? '',
        driver: dbBot.driver as WhatsAppDriverType,
        status: dbBot.status as BotConnectionStatus,
        isActive: dbBot.isActive,
        activeFlowId: mainFlow?.id ?? null,
        activeFlowName: mainFlow?.name ?? null,
        timezone: dbBot.businessHours?.timezone ?? 'America/Bogota',
        outOfHoursMessage:
          dbBot.businessHours?.outOfHoursMessage ??
          'Gracias por comunicarte. Estamos fuera de horario.',
        inactivityTimeoutMinutes: dbBot.inactivityTimeoutMinutes,
        inactivityCloseMessage:
          dbBot.inactivityCloseMessage ?? 'Sesión cerrada por inactividad.',
        typingDelayMs: dbBot.typingDelayMs,
        rateLimitPerMinute: dbBot.rateLimitPerMinute,
        messagesToday: 0,
        activeConversations: 0,
        handoffRate: 0,
        qrCodeData: null,
        qrExpiresAt: null,
        lastConnectedAt:
          dbBot.status === 'CONNECTED' ? dbBot.updatedAt.toISOString() : null,
        chatwootConfig: chatwootDto,
        cloudApiConfig: cloudApiDto,
        businessHours: scheduleDays,
        quickReplies: dbBot.quickReplies.map((qr) => ({
          id: qr.id,
          title: qr.title,
          keywords: qr.keywords,
          responseText: qr.responseText,
          matchMode: (qr.matchMode === 'EXACT' || qr.matchMode === 'REGEX'
            ? qr.matchMode
            : 'CONTAINS') as 'EXACT' | 'CONTAINS' | 'REGEX',
          isActive: qr.isActive
        })),
        createdAt: dbBot.createdAt.toISOString(),
        updatedAt: dbBot.updatedAt.toISOString()
      });
    }

    const dbContacts = await prisma.contact.findMany({
      orderBy: { lastInteractionAt: 'desc' }
    });
    const hydratedContacts: ContactDto[] = dbContacts.map((c) => {
      const vars = (c.variablesJson as Record<string, string>) ?? {};
      const tags = Array.isArray(c.tagsJson) ? (c.tagsJson as string[]) : [];
      return {
        id: c.id,
        organizationId: c.organizationId,
        name: c.name ?? vars.nombre ?? c.phoneNumber,
        phoneNumber: c.phoneNumber,
        email: vars.correo ?? vars.email ?? null,
        nationalId: vars.cedula ?? null,
        chatwootContactId: c.chatwootContactId,
        tags,
        variables: vars,
        conversationsCount: 1,
        lastInteractionAt: c.lastInteractionAt.toISOString(),
        createdAt: c.createdAt.toISOString()
      };
    });

    const dbConversations = await prisma.conversation.findMany({
      include: {
        contact: true,
        bot: true,
        messages: { orderBy: { createdAt: 'asc' } }
      },
      orderBy: { lastMessageAt: 'desc' }
    });

    const hydratedConversations: ConversationDto[] = dbConversations.map((conv) => {
      const sessionState = (conv.sessionStateJson as Record<string, unknown>) ?? {};
      const messages: ConversationMessageDto[] = conv.messages.map((m) => ({
        id: m.id,
        senderType:
          m.direction === 'INBOUND'
            ? 'CONTACT'
            : m.direction === 'OUTBOUND_AGENT'
              ? 'AGENT'
              : 'BOT',
        senderName:
          m.direction === 'INBOUND'
            ? conv.contact.name ?? conv.contact.phoneNumber
            : conv.bot.name,
        content: m.contentText,
        mediaUrl: m.mediaUrl ?? undefined,
        executedNodeId: m.executedNodeId ?? undefined,
        createdAt: m.createdAt.toISOString()
      }));

      return {
        id: conv.id,
        botId: conv.botId,
        botName: conv.bot.name,
        contactId: conv.contactId,
        contactName: conv.contact.name ?? conv.contact.phoneNumber,
        contactPhone: conv.contact.phoneNumber,
        chatwootConversationId: conv.chatwootConversationId,
        status: mapPrismaConversationStatus(conv.status, sessionState),
        assignedAgentName:
          typeof sessionState.assignedAgentName === 'string'
            ? sessionState.assignedAgentName
            : null,
        currentFlowName:
          typeof sessionState.currentFlowName === 'string'
            ? sessionState.currentFlowName
            : null,
        currentNodeId: conv.currentNodeId,
        collectedVariables:
          (sessionState.collectedVariables as Record<string, string>) ??
          ((conv.contact.variablesJson as Record<string, string>) ?? {}),
        tags: Array.isArray(sessionState.tags)
          ? (sessionState.tags as string[])
          : Array.isArray(conv.contact.tagsJson)
            ? (conv.contact.tagsJson as string[])
            : [],
        handoffReason:
          typeof sessionState.handoffReason === 'string'
            ? sessionState.handoffReason
            : null,
        lastMessagePreview:
          messages[messages.length - 1]?.content ?? '',
        lastActivityAt: conv.lastMessageAt.toISOString(),
        messages,
        executionTrace: Array.isArray(sessionState.executionTrace)
          ? (sessionState.executionTrace as FlowExecutionStepLog[])
          : []
      };
    });

    const dbLogs = await prisma.botLog.findMany({
      include: { bot: true },
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    const hydratedLogs: BotLogDto[] = dbLogs.map((l) => ({
      id: l.id,
      botId: l.botId,
      botName: l.bot?.name ?? 'Sistema BotHub',
      level: l.level as BotLogDto['level'],
      event: l.event,
      message: l.message,
      metadata: (l.metadataJson as Record<string, unknown>) ?? {},
      createdAt: l.createdAt.toISOString()
    }));

    target.bots = hydratedBots;
    target.flows = hydratedFlows;
    target.contacts = hydratedContacts;
    target.conversations = hydratedConversations;
    target.logs = hydratedLogs;

    logger.info(
      { bots: hydratedBots.length, flows: hydratedFlows.length },
      'Runtime store hydrated from PostgreSQL'
    );
    return true;
  } catch (err) {
    logger.warn({ err }, 'PostgreSQL hydration skipped; using local runtime store');
    return false;
  }
}

export async function syncBotRecordToDb(
  bot: BotDto,
  cloudSecrets?: StoredCloudApiSecrets
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    const orgExists = await prisma.organization.findUnique({
      where: { id: bot.organizationId }
    });
    if (!orgExists) return;

    await prisma.bot.upsert({
      where: { id: bot.id },
      update: {
        name: bot.name,
        description: bot.description,
        phoneNumber: bot.phoneNumber,
        driver: bot.driver,
        status: bot.status,
        isActive: bot.isActive,
        inactivityTimeoutMinutes: bot.inactivityTimeoutMinutes,
        inactivityCloseMessage: bot.inactivityCloseMessage,
        typingDelayMs: bot.typingDelayMs,
        rateLimitPerMinute: bot.rateLimitPerMinute,
        ...(cloudSecrets
          ? { cloudApiEncryptedConfig: JSON.stringify(cloudSecrets) }
          : {})
      },
      create: {
        id: bot.id,
        organizationId: bot.organizationId,
        name: bot.name,
        description: bot.description,
        phoneNumber: bot.phoneNumber,
        driver: bot.driver,
        status: bot.status,
        isActive: bot.isActive,
        inactivityTimeoutMinutes: bot.inactivityTimeoutMinutes,
        inactivityCloseMessage: bot.inactivityCloseMessage,
        typingDelayMs: bot.typingDelayMs,
        rateLimitPerMinute: bot.rateLimitPerMinute,
        cloudApiEncryptedConfig: cloudSecrets ? JSON.stringify(cloudSecrets) : null
      }
    });

    await prisma.businessHours.upsert({
      where: { botId: bot.id },
      update: {
        timezone: bot.timezone,
        scheduleJson: toJsonInput(bot.businessHours),
        outOfHoursMessage: bot.outOfHoursMessage
      },
      create: {
        botId: bot.id,
        timezone: bot.timezone,
        scheduleJson: toJsonInput(bot.businessHours),
        outOfHoursMessage: bot.outOfHoursMessage
      }
    });
  } catch (err) {
    logger.warn({ botId: bot.id, err }, 'Failed syncing bot record to PostgreSQL');
  }
}

export async function syncChatwootSecretsToDb(
  botId: string,
  secrets: StoredChatwootSecrets
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    const botExists = await prisma.bot.findUnique({ where: { id: botId } });
    if (!botExists) return;
    await prisma.chatwootConfig.upsert({
      where: { botId },
      update: {
        baseUrl: secrets.baseUrl,
        accountId: secrets.accountId,
        inboxId: secrets.inboxId,
        encryptedApiAccessToken: secrets.encryptedApiAccessToken,
        encryptedWebhookToken: secrets.encryptedWebhookToken,
        handoffReturnCommand: secrets.handoffReturnCommand,
        isConnected: secrets.isActive,
        lastVerifiedAt: secrets.lastSyncedAt ? new Date(secrets.lastSyncedAt) : null
      },
      create: {
        botId,
        baseUrl: secrets.baseUrl,
        accountId: secrets.accountId,
        inboxId: secrets.inboxId,
        encryptedApiAccessToken: secrets.encryptedApiAccessToken,
        encryptedWebhookToken: secrets.encryptedWebhookToken,
        handoffReturnCommand: secrets.handoffReturnCommand,
        isConnected: secrets.isActive,
        lastVerifiedAt: secrets.lastSyncedAt ? new Date(secrets.lastSyncedAt) : null
      }
    });
  } catch (err) {
    logger.warn({ botId, err }, 'Failed syncing Chatwoot config to PostgreSQL');
  }
}

export async function syncFlowToDb(flow: FlowDto): Promise<void> {
  if (!isDatabaseConfigured() || !flow.botId) return;
  try {
    const botExists = await prisma.bot.findUnique({ where: { id: flow.botId } });
    if (!botExists) return;

    await prisma.flow.upsert({
      where: { id: flow.id },
      update: {
        botId: flow.botId,
        name: flow.name,
        description: flow.description,
        isMainMenu: flow.isMainMenu,
        draftNodes: toJsonInput(flow.draftVersion.nodes),
        draftEdges: toJsonInput(flow.draftVersion.edges),
        publishedNodes: flow.publishedVersion
          ? toJsonInput(flow.publishedVersion.nodes)
          : Prisma.JsonNull,
        publishedEdges: flow.publishedVersion
          ? toJsonInput(flow.publishedVersion.edges)
          : Prisma.JsonNull,
        publishedVersion: flow.publishedVersion ? flow.activeVersionNumber : 0
      },
      create: {
        id: flow.id,
        botId: flow.botId,
        name: flow.name,
        description: flow.description,
        isMainMenu: flow.isMainMenu,
        draftNodes: toJsonInput(flow.draftVersion.nodes),
        draftEdges: toJsonInput(flow.draftVersion.edges),
        publishedNodes: flow.publishedVersion
          ? toJsonInput(flow.publishedVersion.nodes)
          : Prisma.JsonNull,
        publishedEdges: flow.publishedVersion
          ? toJsonInput(flow.publishedVersion.edges)
          : Prisma.JsonNull,
        publishedVersion: flow.publishedVersion ? flow.activeVersionNumber : 0
      }
    });
  } catch (err) {
    logger.warn({ flowId: flow.id, err }, 'Failed syncing flow to PostgreSQL');
  }
}

export async function syncConversationStateToDb(
  contact: ContactDto,
  conversation: ConversationDto
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    const botExists = await prisma.bot.findUnique({ where: { id: conversation.botId } });
    if (!botExists) return;

    await prisma.contact.upsert({
      where: { id: contact.id },
      update: {
        name: contact.name,
        chatwootContactId: contact.chatwootContactId,
        variablesJson: toJsonInput(contact.variables),
        tagsJson: toJsonInput(contact.tags),
        lastInteractionAt: new Date(contact.lastInteractionAt)
      },
      create: {
        id: contact.id,
        organizationId: contact.organizationId,
        botId: conversation.botId,
        phoneNumber: contact.phoneNumber,
        name: contact.name,
        chatwootContactId: contact.chatwootContactId,
        variablesJson: toJsonInput(contact.variables),
        tagsJson: toJsonInput(contact.tags),
        lastInteractionAt: new Date(contact.lastInteractionAt)
      }
    });

    await prisma.conversation.upsert({
      where: { id: conversation.id },
      update: {
        chatwootConversationId: conversation.chatwootConversationId,
        status: toPrismaConversationStatus(conversation.status),
        currentNodeId: conversation.currentNodeId,
        lastMessageAt: new Date(conversation.lastActivityAt),
        sessionStateJson: toJsonInput({
          uiStatus: conversation.status,
          assignedAgentName: conversation.assignedAgentName,
          currentFlowName: conversation.currentFlowName,
          handoffReason: conversation.handoffReason,
          collectedVariables: conversation.collectedVariables,
          tags: conversation.tags,
          executionTrace: conversation.executionTrace.slice(-40)
        })
      },
      create: {
        id: conversation.id,
        organizationId: contact.organizationId,
        botId: conversation.botId,
        contactId: contact.id,
        chatwootConversationId: conversation.chatwootConversationId,
        status: toPrismaConversationStatus(conversation.status),
        currentNodeId: conversation.currentNodeId,
        lastMessageAt: new Date(conversation.lastActivityAt),
        sessionStateJson: toJsonInput({
          uiStatus: conversation.status,
          assignedAgentName: conversation.assignedAgentName,
          currentFlowName: conversation.currentFlowName,
          handoffReason: conversation.handoffReason,
          collectedVariables: conversation.collectedVariables,
          tags: conversation.tags,
          executionTrace: conversation.executionTrace.slice(-40)
        })
      }
    });
  } catch (err) {
    logger.warn({ conversationId: conversation.id, err }, 'Failed syncing conversation to PostgreSQL');
  }
}

export async function syncLogToDb(
  organizationId: string,
  entry: BotLogDto
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    const orgExists = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!orgExists) return;
    await prisma.botLog.create({
      data: {
        id: entry.id,
        organizationId,
        botId: entry.botId,
        level: entry.level,
        event: entry.event,
        message: entry.message,
        metadataJson: toJsonInput(entry.metadata)
      }
    });
  } catch {
    void 0;
  }
}

export async function deleteBotFromDb(botId: string): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    await prisma.bot.deleteMany({ where: { id: botId } });
  } catch (err) {
    logger.warn({ botId, err }, 'Failed deleting bot from PostgreSQL');
  }
}

export async function deleteFlowFromDb(flowId: string): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    await prisma.flow.deleteMany({ where: { id: flowId } });
  } catch (err) {
    logger.warn({ flowId, err }, 'Failed deleting flow from PostgreSQL');
  }
}
