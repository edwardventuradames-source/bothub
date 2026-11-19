import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ApiKeyDto,
  BotDto,
  BotLogDto,
  ContactDto,
  ConversationDto,
  DashboardMetricsDto,
  FlowDto,
  OrganizationUserDto,
  OutboundWebhookConfigDto
} from '@bothub/shared';
import {
  decryptSecret,
  encryptSecret,
  generateRandomOpaqueToken
} from './crypto.js';

import { resolveSessionsDir } from '../config/env.js';

export const DEFAULT_ORG_ID = '00000000-0000-4000-8000-000000000100';

const SESSIONS_DIR = resolveSessionsDir();
const USERS_STORAGE_FILE = path.join(SESSIONS_DIR, 'users.json');
const RUNTIME_STATE_FILE = path.join(SESSIONS_DIR, 'runtime-state.json');

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

export interface StoredChatwootSecrets {
  baseUrl: string;
  accountId: number;
  inboxId: number;
  encryptedApiAccessToken: string;
  encryptedWebhookToken: string;
  handoffReturnCommand: string;
  isActive: boolean;
  lastSyncedAt: string | null;
}

export interface StoredCloudApiSecrets {
  phoneNumberId: string;
  wabaId: string;
  encryptedAccessToken: string;
  encryptedVerifyToken: string;
  encryptedAppSecret?: string;
}

export interface StoredUserRecord extends OrganizationUserDto {
  organizationId: string;
  organizationName: string;
  passwordHash: string;
}

export function maskSecretValue(secret: string): string {
  if (secret.length <= 8) {
    return '••••••••';
  }
  return `${secret.slice(0, 4)}••••••••${secret.slice(-4)}`;
}

class RuntimeStore {
  public users: StoredUserRecord[] = [];
  public bots: BotDto[] = [];
  public chatwootSecrets = new Map<string, StoredChatwootSecrets>();
  public cloudApiSecrets = new Map<string, StoredCloudApiSecrets>();
  public flows: FlowDto[] = [];
  public conversations: ConversationDto[] = [];
  public contacts: ContactDto[] = [];
  public logs: BotLogDto[] = [];
  public apiKeys: ApiKeyDto[] = [];
  public outboundWebhooks: OutboundWebhookConfigDto[] = [];

  constructor() {
    this.reloadUsersFromDisk();
    this.reloadStateFromDisk();
  }

  public reloadStateFromDisk(): void {
    if (isTestRuntime()) {
      return;
    }
    try {
      if (!fs.existsSync(RUNTIME_STATE_FILE)) {
        return;
      }
      const raw = fs.readFileSync(RUNTIME_STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as {
        bots?: BotDto[];
        chatwootSecrets?: Array<[string, StoredChatwootSecrets]>;
        cloudApiSecrets?: Array<[string, StoredCloudApiSecrets]>;
        flows?: FlowDto[];
        conversations?: ConversationDto[];
        contacts?: ContactDto[];
        logs?: BotLogDto[];
        apiKeys?: ApiKeyDto[];
        outboundWebhooks?: OutboundWebhookConfigDto[];
      };

      if (Array.isArray(parsed.bots)) this.bots = parsed.bots;
      if (Array.isArray(parsed.chatwootSecrets)) {
        this.chatwootSecrets = new Map(parsed.chatwootSecrets);
      }
      if (Array.isArray(parsed.cloudApiSecrets)) {
        this.cloudApiSecrets = new Map(parsed.cloudApiSecrets);
      }
      if (Array.isArray(parsed.flows)) this.flows = parsed.flows;
      if (Array.isArray(parsed.conversations)) this.conversations = parsed.conversations;
      if (Array.isArray(parsed.contacts)) this.contacts = parsed.contacts;
      if (Array.isArray(parsed.logs)) this.logs = parsed.logs;
      if (Array.isArray(parsed.apiKeys)) this.apiKeys = parsed.apiKeys;
      if (Array.isArray(parsed.outboundWebhooks)) {
        this.outboundWebhooks = parsed.outboundWebhooks;
      }
    } catch {
      void 0;
    }
  }

  public persistStateToDisk(): void {
    if (isTestRuntime()) {
      return;
    }
    try {
      if (!fs.existsSync(SESSIONS_DIR)) {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      }
      const payload = {
        bots: this.bots,
        chatwootSecrets: Array.from(this.chatwootSecrets.entries()),
        cloudApiSecrets: Array.from(this.cloudApiSecrets.entries()),
        flows: this.flows,
        conversations: this.conversations,
        contacts: this.contacts,
        logs: this.logs,
        apiKeys: this.apiKeys,
        outboundWebhooks: this.outboundWebhooks
      };
      fs.writeFileSync(
        RUNTIME_STATE_FILE,
        JSON.stringify(payload, null, 2),
        'utf8'
      );
    } catch {
      void 0;
    }
  }

  public reloadUsersFromDisk(): void {
    try {
      if (!fs.existsSync(USERS_STORAGE_FILE)) {
        return;
      }
      const raw = fs.readFileSync(USERS_STORAGE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as StoredUserRecord[];
      if (Array.isArray(parsed)) {
        for (const diskUser of parsed) {
          const existingIdx = this.users.findIndex(
            (u) => u.email.toLowerCase() === diskUser.email.toLowerCase()
          );
          if (existingIdx >= 0) {
            this.users[existingIdx] = diskUser;
          } else {
            this.users.push(diskUser);
          }
        }
      }
    } catch {
      void 0;
    }
  }

  public persistUsersToDisk(): void {
    try {
      if (!fs.existsSync(SESSIONS_DIR)) {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      }
      fs.writeFileSync(
        USERS_STORAGE_FILE,
        JSON.stringify(this.users, null, 2),
        'utf8'
      );
    } catch {
      void 0;
    }
  }

  public upsertStoredUser(user: StoredUserRecord): StoredUserRecord {
    this.reloadUsersFromDisk();
    const existingIndex = this.users.findIndex(
      (u) => u.email.toLowerCase() === user.email.toLowerCase()
    );
    if (existingIndex >= 0) {
      this.users[existingIndex] = user;
    } else {
      this.users.push(user);
    }
    this.persistUsersToDisk();
    return user;
  }

  public saveChatwootConfigForBot(
    botId: string,
    input: {
      baseUrl: string;
      accountId: number;
      inboxId: number;
      apiAccessToken: string;
      webhookToken: string;
      handoffReturnCommand: string;
      isActive?: boolean;
    }
  ): void {
    const encryptedApiAccessToken = encryptSecret(input.apiAccessToken);
    const encryptedWebhookToken = encryptSecret(input.webhookToken);

    this.chatwootSecrets.set(botId, {
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      accountId: input.accountId,
      inboxId: input.inboxId,
      encryptedApiAccessToken,
      encryptedWebhookToken,
      handoffReturnCommand: input.handoffReturnCommand || '#bot',
      isActive: input.isActive ?? true,
      lastSyncedAt: new Date().toISOString()
    });

    const bot = this.bots.find((item) => item.id === botId);
    if (bot) {
      bot.chatwootConfig = this.getChatwootConfigDto(botId);
      bot.status = 'CONNECTED';
      bot.isActive = true;
      bot.lastConnectedAt = new Date().toISOString();
      bot.updatedAt = new Date().toISOString();
    }
    this.persistStateToDisk();
  }

  public getChatwootConfigDto(botId: string) {
    const stored = this.chatwootSecrets.get(botId);
    if (!stored) {
      return null;
    }
    const rawApiToken = decryptSecret(stored.encryptedApiAccessToken);
    const rawWebhookToken = decryptSecret(stored.encryptedWebhookToken);
    return {
      baseUrl: stored.baseUrl,
      accountId: stored.accountId,
      inboxId: stored.inboxId,
      hasApiAccessToken: rawApiToken.length > 0,
      maskedApiAccessToken: maskSecretValue(rawApiToken),
      webhookTokenPreview: maskSecretValue(rawWebhookToken),
      webhookEndpointPath: `/api/webhooks/chatwoot/${botId}`,
      handoffReturnCommand: stored.handoffReturnCommand,
      isActive: stored.isActive,
      lastSyncedAt: stored.lastSyncedAt
    };
  }

  public getDecryptedChatwootTokens(botId: string): {
    apiAccessToken: string;
    webhookToken: string;
    handoffReturnCommand: string;
  } | null {
    const stored = this.chatwootSecrets.get(botId);
    if (!stored) {
      return null;
    }
    return {
      apiAccessToken: decryptSecret(stored.encryptedApiAccessToken),
      webhookToken: decryptSecret(stored.encryptedWebhookToken),
      handoffReturnCommand: stored.handoffReturnCommand
    };
  }

  public saveCloudApiConfigForBot(
    botId: string,
    input: {
      phoneNumberId: string;
      wabaId: string;
      accessToken: string;
      verifyToken: string;
      appSecret?: string;
    }
  ): void {
    const existing = this.cloudApiSecrets.get(botId);
    const trimmedAppSecret = input.appSecret?.trim();
    const encryptedAppSecret = trimmedAppSecret
      ? encryptSecret(trimmedAppSecret)
      : existing?.encryptedAppSecret;

    this.cloudApiSecrets.set(botId, {
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      encryptedAccessToken: encryptSecret(input.accessToken),
      encryptedVerifyToken: encryptSecret(input.verifyToken),
      ...(encryptedAppSecret ? { encryptedAppSecret } : {})
    });

    const bot = this.bots.find((item) => item.id === botId);
    if (bot) {
      bot.cloudApiConfig = this.getCloudApiConfigDto(botId);
      bot.updatedAt = new Date().toISOString();
    }
    this.persistStateToDisk();
  }

  public getCloudApiConfigDto(botId: string) {
    const stored = this.cloudApiSecrets.get(botId);
    if (!stored) {
      return null;
    }
    const rawAccessToken = decryptSecret(stored.encryptedAccessToken);
    const rawVerifyToken = decryptSecret(stored.encryptedVerifyToken);
    return {
      phoneNumberId: stored.phoneNumberId,
      wabaId: stored.wabaId,
      hasAccessToken: rawAccessToken.length > 0,
      hasAppSecret: Boolean(stored.encryptedAppSecret),
      maskedAccessToken: maskSecretValue(rawAccessToken),
      verifyTokenPreview: maskSecretValue(rawVerifyToken),
      webhookPath: `/api/webhooks/whatsapp-cloud/${botId}`
    };
  }

  public getDecryptedCloudVerifyToken(botId: string): string | null {
    const stored = this.cloudApiSecrets.get(botId);
    if (!stored) {
      return null;
    }
    return decryptSecret(stored.encryptedVerifyToken);
  }

  public getDecryptedCloudApiCredentials(botId: string): {
    phoneNumberId: string;
    wabaId: string;
    accessToken: string;
    verifyToken: string;
    appSecret: string | null;
  } | null {
    const stored = this.cloudApiSecrets.get(botId);
    if (!stored) {
      return null;
    }
    return {
      phoneNumberId: stored.phoneNumberId,
      wabaId: stored.wabaId,
      accessToken: decryptSecret(stored.encryptedAccessToken),
      verifyToken: decryptSecret(stored.encryptedVerifyToken),
      appSecret: stored.encryptedAppSecret
        ? decryptSecret(stored.encryptedAppSecret)
        : null
    };
  }

  public appendLog(entry: {
    botId: string | null;
    botName?: string;
    level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
    event: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): BotLogDto {
    const bot = entry.botId ? this.bots.find((item) => item.id === entry.botId) : null;
    const logItem: BotLogDto = {
      id: `log-${crypto.randomUUID().slice(0, 8)}`,
      botId: entry.botId,
      botName: entry.botName ?? bot?.name ?? 'Sistema BotHub',
      level: entry.level,
      event: entry.event,
      message: entry.message,
      metadata: entry.metadata ?? {},
      createdAt: new Date().toISOString()
    };
    this.logs.unshift(logItem);
    if (this.logs.length > 200) {
      this.logs.pop();
    }
    this.persistStateToDisk();
    return logItem;
  }

  public createApiKey(name: string, scopes: string[]): ApiKeyDto {
    const rawSecret = `bh_live_${generateRandomOpaqueToken(18)}`;
    const newKey: ApiKeyDto = {
      id: `ak-${crypto.randomUUID().slice(0, 8)}`,
      name,
      keyPrefix: rawSecret.slice(0, 14),
      scopes,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      rawKeyPreview: rawSecret
    };
    this.apiKeys.unshift(newKey);
    this.persistStateToDisk();
    return newKey;
  }

  public getDashboardMetrics(organizationId?: string): DashboardMetricsDto {
    const scopedBots = organizationId
      ? this.bots.filter((bot) => bot.organizationId === organizationId)
      : this.bots;
    const scopedBotIds = new Set(scopedBots.map((b) => b.id));
    const scopedConversations = organizationId
      ? this.conversations.filter((conv) => scopedBotIds.has(conv.botId))
      : this.conversations;

    const activeBots = scopedBots.filter((bot) => bot.status === 'CONNECTED').length;
    const messagesToday = scopedBots.reduce((sum, bot) => sum + bot.messagesToday, 0);
    const activeConversations = scopedConversations.filter(
      (conv) => conv.status !== 'RESOLVED'
    ).length;
    const handoffCountToday = scopedConversations.filter(
      (conv) => conv.status === 'PENDING_AGENT' || conv.status === 'AGENT_ACTIVE'
    ).length;

    const automationRatePercent =
      activeConversations > 0
        ? Math.round(
            ((activeConversations - handoffCountToday) / activeConversations) * 1000
          ) / 10
        : 0;

    return {
      activeBots,
      totalBots: scopedBots.length,
      messagesToday,
      activeConversations,
      handoffCountToday,
      automationRatePercent,
      hourlyMessages: [],
      weeklyFlowPerformance: [],
      topTriggeredNodes: []
    };
  }
}

export const runtimeStore = new RuntimeStore();
