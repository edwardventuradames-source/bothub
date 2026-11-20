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
  FlowExecutionStepLog,
  WhatsAppDriverType
} from '@bothub/shared';
import { prisma } from './prisma.js';
import { redis } from './redis.js';
import { logger } from './logger.js';
import { createDefaultBusinessHours } from './runtime-seed-graphs.js';
import {
  hydrateStandaloneFlowsFromDb,
  mapDbFlowRecordToDto,
  syncFlowToDb,
  deleteFlowFromDb
} from './persistence-flows.js';
import {
  HydratableDbMessageRecord,
  deleteAiCredentialFromDb,
  deleteApiKeyFromDb,
  deleteOutboundWebhookFromDb,
  isPlatformDbEnabled,
  mapDbMessageToDto,
  syncAiCredentialToDb,
  syncAiTokenBudgetToDb,
  syncApiKeyToDb,
  syncConversationMessagesToDb,
  syncLogToDb,
  syncOutboundWebhookToDb
} from './persistence-platform.js';

export {
  deleteAiCredentialFromDb,
  deleteApiKeyFromDb,
  deleteFlowFromDb,
  deleteOutboundWebhookFromDb,
  mapDbMessageToDto,
  syncAiCredentialToDb,
  syncAiTokenBudgetToDb,
  syncApiKeyToDb,
  syncConversationMessagesToDb,
  syncFlowToDb,
  syncLogToDb,
  syncOutboundWebhookToDb
};
import {
  StoredAiCredentialRecord,
  StoredAiTokenBudgetRecord,
  StoredApiKeyRecord,
  StoredChatwootSecrets,
  StoredCloudApiSecrets,
  StoredOutboundWebhookRecord,
  StoredUserRecord,
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

export async function hydrateStoreFromDatabase(
  target: {
    users: StoredUserRecord[];
    bots: BotDto[];
    chatwootSecrets: Map<string, StoredChatwootSecrets>;
    cloudApiSecrets: Map<string, StoredCloudApiSecrets>;
    flows: FlowDto[];
    contacts: ContactDto[];
    conversations: ConversationDto[];
    logs: BotLogDto[];
    apiKeys: StoredApiKeyRecord[];
    outboundWebhooks: StoredOutboundWebhookRecord[];
    aiCredentials?: Map<string, StoredAiCredentialRecord>;
    aiTokenBudgets?: Map<string, StoredAiTokenBudgetRecord>;
  },
  options: { forceDb?: boolean } = {}
): Promise<boolean> {
  if (!isPlatformDbEnabled(options.forceDb)) {
    return false;
  }

  try {
    const dbUsers = await prisma.user.findMany({
      include: { organization: true }
    });
    if (dbUsers.length > 0) {
      target.users = dbUsers.map((u) => ({
        id: u.id,
        organizationId: u.organizationId,
        organizationName: u.organization.name,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        createdAt: u.createdAt.toISOString(),
        passwordHash: u.passwordHash,
        tokenVersion: u.tokenVersion
      }));
    }

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
          ...(cw.encryptedUserApiAccessToken
            ? { encryptedUserApiAccessToken: cw.encryptedUserApiAccessToken }
            : {}),
          encryptedWebhookToken: cw.encryptedWebhookToken,
          handoffReturnCommand: cw.handoffReturnCommand,
          isActive: cw.isConnected,
          lastSyncedAt: cw.lastVerifiedAt ? cw.lastVerifiedAt.toISOString() : null
        });
        const rawApi = decryptSecret(cw.encryptedApiAccessToken);
        const rawUserApi = cw.encryptedUserApiAccessToken
          ? decryptSecret(cw.encryptedUserApiAccessToken)
          : '';
        const rawWh = decryptSecret(cw.encryptedWebhookToken);
        chatwootDto = {
          baseUrl: cw.baseUrl,
          accountId: cw.accountId,
          inboxId: cw.inboxId,
          hasApiAccessToken: rawApi.length > 0,
          hasUserApiAccessToken: rawUserApi.length > 0,
          maskedApiAccessToken: maskSecretValue(rawApi),
          maskedUserApiAccessToken: rawUserApi ? maskSecretValue(rawUserApi) : '',
          webhookTokenPreview: maskSecretValue(rawWh),
          webhookEndpointPath: `/api/webhooks/chatwoot/${dbBot.id}`,
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
        hydratedFlows.push(
          mapDbFlowRecordToDto(dbFlow, dbBot.organizationId, dbBot.name)
        );
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
        businessHoursEnabled: dbBot.businessHours?.isEnabled ?? false,
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
      const contactDisplayName = conv.contact.name ?? conv.contact.phoneNumber;
      const dbMessages: ConversationMessageDto[] = conv.messages.map((m) =>
        mapDbMessageToDto(
          m as HydratableDbMessageRecord,
          contactDisplayName,
          conv.bot.name
        )
      );
      const diskConv = target.conversations.find((c) => c.id === conv.id);
      const messages =
        dbMessages.length > 0 ? dbMessages : (diskConv?.messages ?? []);
      if (dbMessages.length === 0 && messages.length > 0) {
        void syncConversationMessagesToDb(conv.id, messages, options.forceDb);
      }

      return {
        id: conv.id,
        botId: conv.botId,
        botName: conv.bot.name,
        contactId: conv.contactId,
        contactName: contactDisplayName,
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
          messages[messages.length - 1]?.content ?? diskConv?.lastMessagePreview ?? '',
        lastActivityAt: conv.lastMessageAt.toISOString(),
        messages,
        executionTrace: Array.isArray(sessionState.executionTrace)
          ? (sessionState.executionTrace as FlowExecutionStepLog[])
          : []
      };
    });

    const todayKey = new Date().toISOString().slice(0, 10);
    for (const bot of hydratedBots) {
      bot.messagesToday = hydratedConversations
        .filter((conv) => conv.botId === bot.id)
        .reduce(
          (sum, conv) =>
            sum +
            conv.messages.filter((msg) => msg.createdAt.slice(0, 10) === todayKey)
              .length,
          0
        );
    }
    for (const contact of hydratedContacts) {
      const count = hydratedConversations.filter(
        (conv) => conv.contactId === contact.id
      ).length;
      if (count > 0) {
        contact.conversationsCount = count;
      }
    }

    const dbLogs = await prisma.botLog.findMany({
      include: { bot: true },
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    const hydratedLogs: BotLogDto[] = dbLogs.map((l) => ({
      id: l.id,
      organizationId: l.organizationId,
      botId: l.botId,
      botName: l.bot?.name ?? 'Sistema BotHub',
      level: l.level as BotLogDto['level'],
      event: l.event,
      message: l.message,
      metadata: (l.metadataJson as Record<string, unknown>) ?? {},
      createdAt: l.createdAt.toISOString()
    }));

    const dbApiKeys = await prisma.apiKey.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });
    if (dbApiKeys.length > 0) {
      target.apiKeys = dbApiKeys.map((k) => ({
        id: k.id,
        organizationId: k.organizationId,
        name: k.name,
        keyPrefix: k.keyPrefix,
        keyHash: k.keyHash,
        scopes: ['bots:read', 'flows:execute', 'webhooks:write'],
        lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
        createdAt: k.createdAt.toISOString()
      }));
    }

    const dbWebhooks = await prisma.webhookConfig.findMany({
      orderBy: { createdAt: 'desc' }
    });
    if (dbWebhooks.length > 0) {
      target.outboundWebhooks = dbWebhooks.map((w) => {
        let masked = '••••••••';
        try {
          masked = maskSecretValue(decryptSecret(w.encryptedSecret));
        } catch {
          void 0;
        }
        return {
          id: w.id,
          organizationId: w.organizationId,
          name: w.name,
          targetUrl: w.targetUrl,
          events: Array.isArray(w.eventsJson) ? (w.eventsJson as string[]) : [],
          maskedSecret: masked,
          encryptedSecret: w.encryptedSecret,
          isActive: w.isActive,
          createdAt: w.createdAt.toISOString()
        };
      });
    }

    if (target.aiCredentials) {
      const dbAiCreds = await prisma.aiProviderCredential.findMany();
      for (const cred of dbAiCreds) {
        if (
          cred.provider === 'openai' ||
          cred.provider === 'anthropic' ||
          cred.provider === 'gemini'
        ) {
          target.aiCredentials.set(`${cred.organizationId}:${cred.provider}`, {
            organizationId: cred.organizationId,
            provider: cred.provider,
            encryptedApiKey: cred.encryptedApiKey,
            updatedAt: cred.updatedAt.toISOString()
          });
        }
      }
    }

    if (target.aiTokenBudgets) {
      const dbBudgets = await prisma.aiTokenBudget.findMany();
      for (const b of dbBudgets) {
        target.aiTokenBudgets.set(b.organizationId, {
          organizationId: b.organizationId,
          monthlyLimit: b.monthlyLimit,
          tokensUsed: b.tokensUsed,
          periodKey: b.periodKey,
          updatedAt: b.updatedAt.toISOString()
        });
      }
    }

    const standaloneFlows = await hydrateStandaloneFlowsFromDb();
    for (const sf of standaloneFlows) {
      if (!hydratedFlows.some((f) => f.id === sf.id)) {
        hydratedFlows.push(sf);
      }
    }

    if (hydratedBots.length > 0) target.bots = hydratedBots;
    if (hydratedFlows.length > 0) target.flows = hydratedFlows;
    if (hydratedContacts.length > 0) target.contacts = hydratedContacts;
    if (hydratedConversations.length > 0) target.conversations = hydratedConversations;
    if (hydratedLogs.length > 0) target.logs = hydratedLogs;

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
        isEnabled: Boolean(bot.businessHoursEnabled),
        scheduleJson: toJsonInput(bot.businessHours),
        outOfHoursMessage: bot.outOfHoursMessage
      },
      create: {
        botId: bot.id,
        timezone: bot.timezone,
        isEnabled: Boolean(bot.businessHoursEnabled),
        scheduleJson: toJsonInput(bot.businessHours),
        outOfHoursMessage: bot.outOfHoursMessage
      }
    });

    await prisma.quickReply.deleteMany({ where: { botId: bot.id } });
    if (bot.quickReplies.length > 0) {
      await prisma.quickReply.createMany({
        data: bot.quickReplies.map((qr) => ({
          id: qr.id,
          botId: bot.id,
          title: qr.title,
          keywords: qr.keywords,
          matchMode: qr.matchMode === 'EXACT' || qr.matchMode === 'REGEX' ? qr.matchMode : 'CONTAINS',
          responseText: qr.responseText,
          isActive: qr.isActive
        }))
      });
    }
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
        encryptedUserApiAccessToken: secrets.encryptedUserApiAccessToken ?? null,
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
        encryptedUserApiAccessToken: secrets.encryptedUserApiAccessToken ?? null,
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

export async function syncConversationStateToDb(
  contact: ContactDto,
  conversation: ConversationDto,
  forceDb = false
): Promise<void> {
  if (!isPlatformDbEnabled(forceDb)) return;
  try {
    const botExists = await prisma.bot.findUnique({ where: { id: conversation.botId } });
    if (!botExists) return;

    const persistedContact = await prisma.contact.upsert({
      where: {
        botId_phoneNumber: {
          botId: conversation.botId,
          phoneNumber: contact.phoneNumber
        }
      },
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
        contactId: persistedContact.id,
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
        contactId: persistedContact.id,
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

    await syncConversationMessagesToDb(
      conversation.id,
      conversation.messages,
      forceDb
    );
  } catch (err) {
    logger.warn({ conversationId: conversation.id, err }, 'Failed syncing conversation to PostgreSQL');
  }
}

export async function syncContactToDb(contact: ContactDto): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    await prisma.contact.updateMany({
      where: {
        id: contact.id,
        organizationId: contact.organizationId
      },
      data: {
        name: contact.name,
        variablesJson: toJsonInput(contact.variables),
        tagsJson: toJsonInput(contact.tags),
        lastInteractionAt: new Date(contact.lastInteractionAt)
      }
    });
  } catch (err) {
    logger.warn({ contactId: contact.id, err }, 'Failed syncing contact to PostgreSQL');
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
