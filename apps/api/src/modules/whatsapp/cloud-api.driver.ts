import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import {
  CloudApiCredentialsInput,
  FlowSimulationBotReply
} from '@bothub/shared';
import { verifySecretConstantTime } from '../../lib/crypto.js';
import { env } from '../../config/env.js';
import { runtimeStore } from '../../lib/runtime-store.js';
import { syncBotRecordToDb } from '../../lib/persistence.js';
import { formatBotReplyForChatwoot } from '../chatwoot/chatwoot.client.js';
import { processInboundWhatsAppMessage } from './inbound-pipeline.js';
import {
  OutboundWhatsAppMessage,
  WhatsAppProviderDriver,
  WhatsAppSessionRuntimeState
} from './whatsapp.types.js';

const META_GRAPH_API_VERSION = 'v21.0';
const META_HTTP_TIMEOUT_MS = 8000;

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

export interface ParsedCloudWebhookMessage {
  fromPhone: string;
  contactName: string;
  text: string;
  externalMessageId?: string;
}

export interface MetaCloudWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: {
          phone_number_id?: string;
        };
        contacts?: Array<{
          wa_id?: string;
          profile?: { name?: string };
        }>;
        messages?: Array<{
          from?: string;
          id?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string; payload?: string };
          interactive?: {
            type?: string;
            button_reply?: { id?: string; title?: string };
            list_reply?: { id?: string; title?: string };
          };
        }>;
        statuses?: Array<Record<string, unknown>>;
      };
    }>;
  }>;
}

export class CloudApiDriver implements WhatsAppProviderDriver {
  public readonly driverType = 'CLOUD_API' as const;
  private readonly states = new Map<string, WhatsAppSessionRuntimeState>();
  private io: SocketIOServer | null = null;

  public bindSocketServer(io: SocketIOServer): void {
    this.io = io;
  }

  private emitStatus(state: WhatsAppSessionRuntimeState): void {
    if (!this.io) {
      return;
    }
    this.io.to(`org:${state.organizationId}`).emit('whatsapp:status', state);
  }

  public async saveEncryptedCredentials(
    botId: string,
    organizationId: string,
    credentials: CloudApiCredentialsInput
  ): Promise<WhatsAppSessionRuntimeState> {
    const bot = runtimeStore.bots.find(
      (item) => item.id === botId && item.organizationId === organizationId
    );
    if (!bot) {
      throw new Error('Bot no encontrado');
    }

    const resolvedWabaId =
      credentials.wabaId || credentials.businessAccountId || '';

    runtimeStore.saveCloudApiConfigForBot(botId, {
      phoneNumberId: credentials.phoneNumberId,
      wabaId: resolvedWabaId,
      accessToken: credentials.accessToken,
      verifyToken: credentials.verifyToken,
      appSecret: credentials.appSecret
    });

    bot.driver = 'CLOUD_API';
    bot.status = 'CONNECTED';
    bot.isActive = true;
    bot.qrCodeData = null;
    bot.qrExpiresAt = null;
    bot.lastConnectedAt = new Date().toISOString();
    bot.updatedAt = new Date().toISOString();
    runtimeStore.persistStateToDisk();

    const storedCloudSecrets = runtimeStore.cloudApiSecrets.get(botId);
    void syncBotRecordToDb(bot, storedCloudSecrets);

    runtimeStore.appendLog({
      botId: bot.id,
      botName: bot.name,
      level: 'INFO',
      event: 'whatsapp.cloud_api.configured',
      message: `Driver WhatsApp Cloud API configurado y cifrado con AES-256-GCM para ${bot.name}.`
    });

    const nextState: WhatsAppSessionRuntimeState = {
      botId,
      organizationId,
      driver: 'CLOUD_API',
      status: 'CONNECTED',
      phoneNumber: bot.phoneNumber,
      qrDataUrl: null,
      rawQr: null,
      qrGeneratedAt: null,
      lastError: null,
      updatedAt: bot.updatedAt
    };

    this.states.set(botId, nextState);
    this.emitStatus(nextState);
    return nextState;
  }

  public verifyWebhookSubscription(
    botId: string,
    mode: string | undefined,
    verifyToken: string | undefined,
    challenge: string | undefined
  ): { verified: boolean; challengeResponse: string } {
    const expectedToken = runtimeStore.getDecryptedCloudVerifyToken(botId);
    if (
      mode !== 'subscribe' ||
      !verifyToken ||
      !expectedToken ||
      !verifySecretConstantTime(verifyToken, expectedToken)
    ) {
      return { verified: false, challengeResponse: '' };
    }
    return {
      verified: true,
      challengeResponse: challenge ?? 'OK'
    };
  }

  public verifyWebhookSignature(
    botId: string,
    rawBody: string | Buffer,
    signatureHeader: string | undefined
  ): { valid: boolean; reason?: string } {
    const creds = runtimeStore.getDecryptedCloudApiCredentials(botId);
    if (!creds) {
      return { valid: false, reason: 'cloud_api_not_configured' };
    }

    if (creds.appSecret) {
      if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
        return { valid: false, reason: 'missing_signature_header' };
      }
      const expectedSig = `sha256=${crypto
        .createHmac('sha256', creds.appSecret)
        .update(rawBody)
        .digest('hex')}`;
      if (!verifySecretConstantTime(signatureHeader, expectedSig)) {
        return { valid: false, reason: 'invalid_signature' };
      }
      return { valid: true };
    }

    if (env.NODE_ENV === 'production') {
      return { valid: false, reason: 'app_secret_required_in_production' };
    }

    if (signatureHeader) {
      return { valid: false, reason: 'app_secret_not_configured' };
    }

    return { valid: true };
  }

  public parseMetaWebhookPayload(body: unknown): {
    validStructure: boolean;
    isStatusOnly: boolean;
    messages: ParsedCloudWebhookMessage[];
  } {
    if (!body || typeof body !== 'object') {
      return { validStructure: false, isStatusOnly: false, messages: [] };
    }

    const payload = body as MetaCloudWebhookBody;
    if (!Array.isArray(payload.entry) || payload.entry.length === 0) {
      return { validStructure: false, isStatusOnly: false, messages: [] };
    }

    const extracted: ParsedCloudWebhookMessage[] = [];
    let sawStatusUpdate = false;

    for (const entryItem of payload.entry) {
      if (!Array.isArray(entryItem.changes)) continue;
      for (const change of entryItem.changes) {
        const value = change.value;
        if (!value) continue;

        if (Array.isArray(value.statuses) && value.statuses.length > 0) {
          sawStatusUpdate = true;
        }

        const contactsMap = new Map<string, string>();
        if (Array.isArray(value.contacts)) {
          for (const contact of value.contacts) {
            if (contact.wa_id && contact.profile?.name) {
              contactsMap.set(contact.wa_id, contact.profile.name);
            }
          }
        }

        if (!Array.isArray(value.messages)) continue;

        for (const msg of value.messages) {
          const rawFrom = msg.from?.trim();
          if (!rawFrom) continue;

          const normalizedPhone = rawFrom.startsWith('+') ? rawFrom : `+${rawFrom}`;
          let text = '';

          if (msg.type === 'text' && msg.text?.body) {
            text = msg.text.body;
          } else if (msg.type === 'interactive' && msg.interactive) {
            text =
              msg.interactive.button_reply?.id ||
              msg.interactive.button_reply?.title ||
              msg.interactive.list_reply?.id ||
              msg.interactive.list_reply?.title ||
              '';
          } else if (msg.type === 'button' && msg.button) {
            text = msg.button.payload || msg.button.text || '';
          } else if (msg.text?.body) {
            text = msg.text.body;
          }

          if (!text.trim()) continue;

          const contactName =
            contactsMap.get(rawFrom) ??
            contactsMap.get(normalizedPhone) ??
            normalizedPhone;

          extracted.push({
            fromPhone: normalizedPhone,
            contactName,
            text: text.trim(),
            externalMessageId: msg.id
          });
        }
      }
    }

    if (extracted.length === 0 && !sawStatusUpdate) {
      return { validStructure: false, isStatusOnly: false, messages: [] };
    }

    return {
      validStructure: true,
      isStatusOnly: extracted.length === 0 && sawStatusUpdate,
      messages: extracted
    };
  }

  public async handleIncomingMessage(
    botId: string,
    input: ParsedCloudWebhookMessage,
    io?: SocketIOServer
  ) {
    return processInboundWhatsAppMessage({
      botId,
      fromPhone: input.fromPhone,
      contactName: input.contactName,
      text: input.text,
      externalMessageId: input.externalMessageId,
      io: io ?? this.io ?? undefined,
      sendReply: async (reply) => {
        await this.sendReply(botId, input.fromPhone, reply);
      }
    });
  }

  public async sendReply(
    botId: string,
    toPhoneNumber: string,
    reply: FlowSimulationBotReply
  ): Promise<{ externalMessageId: string }> {
    if (isTestRuntime()) {
      return { externalMessageId: `wamid.test.${crypto.randomUUID()}` };
    }

    const creds = runtimeStore.getDecryptedCloudApiCredentials(botId);
    if (!creds || !creds.accessToken || !creds.phoneNumberId) {
      throw new Error(`Credenciales Cloud API no configuradas para bot "${botId}".`);
    }

    const normalizedTo = toPhoneNumber.replace(/[^\d]/g, '');
    const endpoint = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${creds.phoneNumberId}/messages`;

    let bodyPayload: Record<string, unknown>;

    if (Array.isArray(reply.buttons) && reply.buttons.length > 0) {
      bodyPayload = {
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: reply.text.slice(0, 1024) },
          action: {
            buttons: reply.buttons.slice(0, 3).map((btn) => ({
              type: 'reply',
              reply: {
                id: btn.id.slice(0, 256),
                title: btn.label.slice(0, 20)
              }
            }))
          }
        }
      };
    } else if (Array.isArray(reply.listItems) && reply.listItems.length > 0) {
      bodyPayload = {
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: reply.text.slice(0, 1024) },
          action: {
            button: 'Ver opciones',
            sections: [
              {
                title: 'Opciones',
                rows: reply.listItems.slice(0, 10).map((item) => ({
                  id: item.id.slice(0, 200),
                  title: item.title.slice(0, 24),
                  description: item.description?.slice(0, 72)
                }))
              }
            ]
          }
        }
      };
    } else {
      bodyPayload = {
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'text',
        text: {
          preview_url: Boolean(reply.mediaUrl),
          body: reply.mediaUrl
            ? `${formatBotReplyForChatwoot(reply)}\n${reply.mediaUrl}`
            : formatBotReplyForChatwoot(reply)
        }
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), META_HTTP_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.accessToken}`
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        runtimeStore.appendLog({
          botId,
          level: 'ERROR',
          event: 'whatsapp.cloud_api.send_failed',
          message: `Error enviando mensaje a Meta Cloud API (${response.status}): ${errorBody.slice(0, 200)}`
        });
        throw new Error(`Meta Cloud API HTTP ${response.status}`);
      }

      const data = (await response.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
      };
      return {
        externalMessageId: data.messages?.[0]?.id ?? `wamid.${crypto.randomUUID()}`
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async connectSession(
    botId: string,
    organizationId: string
  ): Promise<WhatsAppSessionRuntimeState> {
    const bot = runtimeStore.bots.find(
      (item) => item.id === botId && item.organizationId === organizationId
    );
    const hasConfig = Boolean(runtimeStore.getDecryptedCloudApiCredentials(botId));
    const status = hasConfig ? 'CONNECTED' : 'DISCONNECTED';

    if (bot) {
      bot.status = status;
      bot.isActive = hasConfig;
      bot.updatedAt = new Date().toISOString();
      runtimeStore.persistStateToDisk();
      void syncBotRecordToDb(bot);
    }

    const state: WhatsAppSessionRuntimeState = {
      botId,
      organizationId,
      driver: 'CLOUD_API',
      status,
      phoneNumber: bot?.phoneNumber ?? null,
      qrDataUrl: null,
      rawQr: null,
      qrGeneratedAt: null,
      lastError: hasConfig
        ? null
        : 'Configura las credenciales de WhatsApp Cloud API para conectar.',
      updatedAt: new Date().toISOString()
    };

    this.states.set(botId, state);
    this.emitStatus(state);
    return state;
  }

  public async disconnectSession(
    botId: string,
    organizationId: string
  ): Promise<WhatsAppSessionRuntimeState> {
    const bot = runtimeStore.bots.find(
      (item) => item.id === botId && item.organizationId === organizationId
    );
    if (bot) {
      bot.status = 'DISCONNECTED';
      bot.isActive = false;
      bot.updatedAt = new Date().toISOString();
      runtimeStore.persistStateToDisk();
      void syncBotRecordToDb(bot);
    }

    const state: WhatsAppSessionRuntimeState = {
      botId,
      organizationId,
      driver: 'CLOUD_API',
      status: 'DISCONNECTED',
      phoneNumber: bot?.phoneNumber ?? null,
      qrDataUrl: null,
      rawQr: null,
      qrGeneratedAt: null,
      lastError: null,
      updatedAt: new Date().toISOString()
    };

    this.states.set(botId, state);
    this.emitStatus(state);
    return state;
  }

  public async resetSession(
    botId: string,
    organizationId: string
  ): Promise<WhatsAppSessionRuntimeState> {
    return this.connectSession(botId, organizationId);
  }

  public async simulatePairSuccess(
    botId: string,
    organizationId: string,
    _phoneNumber?: string
  ): Promise<WhatsAppSessionRuntimeState> {
    return this.getSessionState(botId, organizationId);
  }

  public async getSessionState(
    botId: string,
    organizationId: string
  ): Promise<WhatsAppSessionRuntimeState> {
    const cached = this.states.get(botId);
    if (cached) {
      return cached;
    }
    const bot = runtimeStore.bots.find(
      (item) => item.id === botId && item.organizationId === organizationId
    );
    return {
      botId,
      organizationId,
      driver: 'CLOUD_API',
      status: bot?.status ?? 'DISCONNECTED',
      phoneNumber: bot?.phoneNumber ?? null,
      qrDataUrl: null,
      rawQr: null,
      qrGeneratedAt: null,
      lastError: null,
      updatedAt: bot?.updatedAt ?? new Date().toISOString()
    };
  }

  public async sendTextMessage(
    botId: string,
    payload: OutboundWhatsAppMessage
  ): Promise<{ externalMessageId: string }> {
    return this.sendReply(botId, payload.toPhoneNumber, {
      id: `out-${crypto.randomUUID().slice(0, 8)}`,
      text: payload.text
    });
  }
}
