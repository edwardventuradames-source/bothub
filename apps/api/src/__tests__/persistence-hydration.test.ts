import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotDto, BotLogDto, ContactDto, ConversationDto, FlowDto } from '@bothub/shared';
import { encryptSecret } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';
import {
  hydrateStoreFromDatabase,
  mapDbMessageToDto,
  syncApiKeyToDb,
  syncConversationStateToDb,
  syncLogToDb,
  syncOutboundWebhookToDb
} from '../lib/persistence.js';
import { runtimeStore } from '../lib/runtime-store.js';

describe('PostgreSQL Persistence & Restart Hydration Suite', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists conversation messages via syncConversationStateToDb and restores 24h dashboard traffic across restarts', async () => {
    const orgId = '00000000-0000-4000-8000-000000000100';
    const botId = 'bot-persist-1';
    const contactId = 'contact-persist-1';
    const convId = 'conv-persist-1';
    const now = new Date();
    const nowIso = now.toISOString();

    const contact: ContactDto = {
      id: contactId,
      organizationId: orgId,
      name: 'Laura Perez',
      phoneNumber: '+18095551234',
      email: null,
      nationalId: '00112345678',
      chatwootContactId: null,
      tags: ['whatsapp-inbound'],
      variables: { nombre: 'Laura Perez', cedula: '00112345678' },
      conversationsCount: 1,
      lastInteractionAt: nowIso,
      createdAt: nowIso
    };

    const conversation: ConversationDto = {
      id: convId,
      botId,
      botName: 'Ventas Bot',
      contactId,
      contactName: 'Laura Perez',
      contactPhone: '+18095551234',
      chatwootConversationId: null,
      status: 'BOT_ACTIVE',
      assignedAgentName: null,
      currentFlowName: 'Consulta Pedidos',
      currentNodeId: null,
      collectedVariables: { cedula: '00112345678', estado_pedido: 'Entregado' },
      tags: ['whatsapp-inbound'],
      handoffReason: null,
      lastMessagePreview: 'Tu pedido fue Entregado',
      lastActivityAt: nowIso,
      messages: [
        {
          id: 'msg-in-1',
          senderType: 'CONTACT',
          senderName: 'Laura Perez',
          content: '00112345678',
          createdAt: nowIso
        },
        {
          id: 'msg-out-1',
          senderType: 'BOT',
          senderName: 'Ventas Bot',
          content: 'Tu pedido fue Entregado',
          executedNodeId: 'n-msg-1',
          executedNodeLabel: 'Respuesta Pedido',
          createdAt: nowIso
        },
        {
          id: 'msg-sys-1',
          senderType: 'SYSTEM',
          senderName: 'BotHub Control',
          content: 'Control devuelto al bot',
          createdAt: nowIso
        }
      ],
      executionTrace: [
        {
          nodeId: 'n-http-1',
          nodeType: 'HTTP_REQUEST',
          title: 'Consultar Pedido',
          detail: 'GET https://botbot.free.beeceptor.com (200)',
          timestamp: nowIso
        }
      ]
    };

    const persistedMessages: Array<{
      id: string;
      conversationId: string;
      direction: 'INBOUND' | 'OUTBOUND_BOT' | 'OUTBOUND_AGENT';
      contentText: string;
      mediaUrl: string | null;
      metadataJson: unknown;
      executedNodeId: string | null;
      createdAt: Date;
    }> = [];

    vi.spyOn(prisma.bot, 'findUnique').mockResolvedValue({ id: botId } as never);
    vi.spyOn(prisma.contact, 'upsert').mockResolvedValue({ id: contactId } as never);
    vi.spyOn(prisma.conversation, 'upsert').mockResolvedValue({ id: convId } as never);
    const createManySpy = vi
      .spyOn(prisma.message, 'createMany')
      .mockImplementation(((args?: { data?: unknown }) => {
        const raw = args?.data;
        const rows = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<
          Record<string, unknown>
        >;
        for (const row of rows) {
          persistedMessages.push({
            id: String(row.id),
            conversationId: String(row.conversationId),
            direction: row.direction as 'INBOUND' | 'OUTBOUND_BOT' | 'OUTBOUND_AGENT',
            contentText: String(row.contentText),
            mediaUrl: row.mediaUrl ? String(row.mediaUrl) : null,
            metadataJson: row.metadataJson ?? {},
            executedNodeId: row.executedNodeId ? String(row.executedNodeId) : null,
            createdAt: row.createdAt instanceof Date ? row.createdAt : new Date()
          });
        }
        return Promise.resolve({ count: rows.length });
      }) as never);

    await syncConversationStateToDb(contact, conversation, true);

    expect(createManySpy).toHaveBeenCalledTimes(1);
    expect(persistedMessages).toHaveLength(3);
    expect(persistedMessages[0]?.direction).toBe('INBOUND');
    expect(persistedMessages[1]?.direction).toBe('OUTBOUND_BOT');
    expect(
      mapDbMessageToDto(persistedMessages[2]!, 'Laura Perez', 'Ventas Bot').senderType
    ).toBe('SYSTEM');

    vi.spyOn(prisma.user, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.bot, 'findMany').mockResolvedValue([
      {
        id: botId,
        organizationId: orgId,
        name: 'Ventas Bot',
        description: '',
        phoneNumber: '+18095550000',
        driver: 'CLOUD_API',
        status: 'CONNECTED',
        isActive: true,
        inactivityTimeoutMinutes: 15,
        inactivityCloseMessage: 'Fin',
        typingDelayMs: 500,
        rateLimitPerMinute: 30,
        cloudApiEncryptedConfig: null,
        chatwootConfig: {
          baseUrl: 'https://chatwoot.example.com',
          accountId: 1,
          inboxId: 2,
          encryptedApiAccessToken: encryptSecret('cw_api_token_123'),
          encryptedUserApiAccessToken: encryptSecret('cw_user_token_456'),
          encryptedWebhookToken: encryptSecret('cw_wh_token_789'),
          handoffReturnCommand: '#bot',
          isConnected: true,
          lastVerifiedAt: now
        },
        businessHours: null,
        quickReplies: [],
        flows: [],
        createdAt: now,
        updatedAt: now
      }
    ] as never);
    vi.spyOn(prisma.contact, 'findMany').mockResolvedValue([
      {
        id: contactId,
        organizationId: orgId,
        botId,
        phoneNumber: contact.phoneNumber,
        name: contact.name,
        chatwootContactId: null,
        variablesJson: contact.variables,
        tagsJson: contact.tags,
        lastInteractionAt: now,
        createdAt: now
      }
    ] as never);
    vi.spyOn(prisma.conversation, 'findMany').mockResolvedValue([
      {
        id: convId,
        organizationId: orgId,
        botId,
        contactId,
        chatwootConversationId: null,
        status: 'BOT_ACTIVE',
        currentNodeId: null,
        lastMessageAt: now,
        sessionStateJson: {
          uiStatus: 'BOT_ACTIVE',
          currentFlowName: 'Consulta Pedidos',
          collectedVariables: conversation.collectedVariables,
          tags: conversation.tags,
          executionTrace: conversation.executionTrace
        },
        contact: {
          name: contact.name,
          phoneNumber: contact.phoneNumber,
          variablesJson: contact.variables,
          tagsJson: contact.tags
        },
        bot: { name: 'Ventas Bot' },
        messages: persistedMessages
      }
    ] as never);
    vi.spyOn(prisma.botLog, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.apiKey, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.webhookConfig, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.flow, 'findMany').mockResolvedValue([]);

    const freshStore = Object.assign(
      Object.create(Object.getPrototypeOf(runtimeStore)) as typeof runtimeStore,
      {
        users: [],
        bots: [] as BotDto[],
        chatwootSecrets: new Map(),
        cloudApiSecrets: new Map(),
        flows: [] as FlowDto[],
        contacts: [] as ContactDto[],
        conversations: [] as ConversationDto[],
        logs: [] as BotLogDto[],
        apiKeys: [],
        outboundWebhooks: []
      }
    );

    const hydrated = await hydrateStoreFromDatabase(freshStore, { forceDb: true });
    expect(hydrated).toBe(true);
    expect(freshStore.conversations[0]?.messages).toHaveLength(3);
    expect(freshStore.conversations[0]?.messages[2]?.senderType).toBe('SYSTEM');
    expect(freshStore.bots[0]?.messagesToday).toBe(3);
    expect(freshStore.bots[0]?.chatwootConfig?.hasUserApiAccessToken).toBe(true);
    expect(freshStore.getDecryptedChatwootTokens(botId)?.userApiAccessToken).toBe(
      'cw_user_token_456'
    );

    const metrics = freshStore.getDashboardMetrics(orgId);
    expect(metrics.messagesToday).toBe(3);
    expect(
      metrics.hourlyMessages.some((b) => b.inbound > 0 && b.outbound > 0)
    ).toBe(true);
    expect(metrics.topTriggeredNodes[0]?.nodeTitle).toBe('Consultar Pedido');
  });

  it('persists BotLog, ApiKey, and WebhookConfig records to PostgreSQL', async () => {
    const orgId = '00000000-0000-4000-8000-000000000100';
    vi.spyOn(prisma.organization, 'findUnique').mockResolvedValue({ id: orgId } as never);
    const logUpsert = vi.spyOn(prisma.botLog, 'upsert').mockResolvedValue({} as never);
    const keyUpsert = vi.spyOn(prisma.apiKey, 'upsert').mockResolvedValue({} as never);
    const whUpsert = vi.spyOn(prisma.webhookConfig, 'upsert').mockResolvedValue({} as never);

    await syncLogToDb(
      orgId,
      {
        id: 'log-1',
        organizationId: orgId,
        botId: null,
        botName: 'Sistema BotHub',
        level: 'INFO',
        event: 'flow.executed',
        message: 'OK',
        metadata: {},
        createdAt: new Date().toISOString()
      },
      true
    );

    await syncApiKeyToDb(
      {
        id: 'ak-1',
        organizationId: orgId,
        name: 'CRM Key',
        keyPrefix: 'bh_live_1234',
        keyHash: 'hash_abc',
        scopes: ['flows:execute'],
        lastUsedAt: null,
        createdAt: new Date().toISOString()
      },
      true
    );

    await syncOutboundWebhookToDb(
      {
        id: 'wh-1',
        organizationId: orgId,
        name: 'CRM Hook',
        targetUrl: 'https://crm.example.com/hook',
        events: ['handoff.created'],
        maskedSecret: 'sec_••••1234',
        encryptedSecret: 'enc_xyz',
        isActive: true,
        createdAt: new Date().toISOString()
      },
      true
    );

    expect(logUpsert).toHaveBeenCalledTimes(1);
    expect(keyUpsert).toHaveBeenCalledTimes(1);
    expect(whUpsert).toHaveBeenCalledTimes(1);
  });
});
