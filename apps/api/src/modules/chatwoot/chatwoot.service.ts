import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import {
  ChatwootConfigInput,
  ConversationDto
} from '@bothub/shared';
import {
  generateRandomOpaqueToken,
  verifySecretConstantTime
} from '../../lib/crypto.js';
import { runtimeStore } from '../../lib/runtime-store.js';
import {
  syncBotRecordToDb,
  syncChatwootSecretsToDb,
  syncConversationStateToDb
} from '../../lib/persistence.js';
import {
  fetchChatwootAccountLabelsApi,
  toggleChatwootConversationStatusApi,
  verifyChatwootConnectionApi
} from './chatwoot.client.js';
import { processIncomingChatwootCustomerMessage } from './chatwoot-inbound.js';

export interface ChatwootWebhookPayload {
  id?: number;
  event?: string;
  status?: string;
  message_type?: 'incoming' | 'outgoing' | 'activity' | 0 | 1 | 2;
  private?: boolean;
  content?: string;
  account?: {
    id?: number;
    name?: string;
  };
  inbox?: {
    id?: number;
    name?: string;
  };
  conversation?: {
    id?: number;
    inbox_id?: number;
    status?: string;
    contact_inbox?: {
      source_id?: string;
    };
    meta?: {
      sender?: {
        id?: number;
        name?: string;
        phone_number?: string;
        email?: string;
      };
    };
  };
  sender?: {
    id?: number;
    name?: string;
    phone_number?: string;
    email?: string;
    type?: string;
  };
}

export class ChatwootWebhookAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatwootWebhookAuthError';
  }
}

export type OutboundWhatsAppForwarder = (params: {
  botId: string;
  toPhoneNumber: string;
  text: string;
}) => Promise<void>;

let outboundForwarder: OutboundWhatsAppForwarder | null = null;

export function registerWhatsAppOutboundForwarder(
  forwarder: OutboundWhatsAppForwarder
): void {
  outboundForwarder = forwarder;
}

export class ChatwootService {
  public static saveConfig(botId: string, input: ChatwootConfigInput) {
    const existingTokens = runtimeStore.getDecryptedChatwootTokens(botId);
    const trimmedApiToken = input.apiAccessToken?.trim() ?? '';
    const trimmedUserToken = input.userApiAccessToken?.trim() ?? '';
    const trimmedWebhookToken = input.webhookToken?.trim() ?? '';
    const resolvedApiToken = trimmedApiToken || existingTokens?.apiAccessToken || '';
    const resolvedUserToken =
      trimmedUserToken || existingTokens?.userApiAccessToken || '';
    const resolvedWebhookToken =
      trimmedWebhookToken ||
      existingTokens?.webhookToken ||
      `whsec_${generateRandomOpaqueToken(16)}`;

    if (resolvedApiToken.length < 6) {
      throw new Error('Token de acceso de Chatwoot inválido (mínimo 6 caracteres).');
    }
    if (resolvedWebhookToken.length < 6) {
      throw new Error('Token de webhook de Chatwoot inválido (mínimo 6 caracteres).');
    }

    const resolvedInput: ChatwootConfigInput = {
      ...input,
      apiAccessToken: resolvedApiToken,
      userApiAccessToken: resolvedUserToken,
      webhookToken: resolvedWebhookToken
    };

    runtimeStore.saveChatwootConfigForBot(botId, {
      ...resolvedInput,
      apiAccessToken: resolvedApiToken,
      userApiAccessToken: resolvedUserToken,
      webhookToken: resolvedWebhookToken,
      handoffReturnCommand: input.handoffReturnCommand || '#bot'
    });
    const dto = runtimeStore.getChatwootConfigDto(botId);
    const storedSecrets = runtimeStore.chatwootSecrets.get(botId);
    const bot = runtimeStore.bots.find((item) => item.id === botId);
    if (bot) {
      void syncBotRecordToDb(bot);
    }
    if (storedSecrets) {
      void syncChatwootSecretsToDb(botId, storedSecrets);
    }

    runtimeStore.appendLog({
      organizationId: bot?.organizationId,
      botId,
      level: 'INFO',
      event: 'chatwoot.config.saved',
      message: `Credenciales de Chatwoot cifradas con AES-256-GCM para Inbox #${input.inboxId}.`,
      metadata: {
        baseUrl: input.baseUrl,
        accountId: input.accountId,
        inboxId: input.inboxId
      }
    });

    return dto;
  }

  public static async testConnection(
    botId: string,
    io?: SocketIOServer
  ): Promise<{
    connected: boolean;
    latencyMs: number;
    inboxName: string;
    message: string;
    bot?: ReturnType<typeof runtimeStore.bots.find>;
  }> {
    const config = runtimeStore.getChatwootConfigDto(botId);
    const secrets = runtimeStore.getDecryptedChatwootTokens(botId);
    const bot = runtimeStore.bots.find((item) => item.id === botId);

    if (!config || !secrets || !secrets.apiAccessToken) {
      throw new Error('El bot aún no tiene configuración de Chatwoot guardada.');
    }

    try {
      const result = await verifyChatwootConnectionApi({
        config,
        apiAccessToken: secrets.apiAccessToken
      });

      if (bot) {
        bot.status = 'CONNECTED';
        bot.isActive = true;
        bot.lastConnectedAt = new Date().toISOString();
        bot.updatedAt = new Date().toISOString();
        runtimeStore.persistStateToDisk();
        void syncBotRecordToDb(bot);
        if (io) {
          io.to(`org:${bot.organizationId}`).emit('whatsapp:status', {
            botId: bot.id,
            status: bot.status,
            driver: bot.driver,
            updatedAt: bot.updatedAt
          });
        }
      }

      runtimeStore.appendLog({
        organizationId: bot?.organizationId,
        botId,
        level: 'INFO',
        event: 'chatwoot.connection.verified',
        message: result.message,
        metadata: {
          accountId: config.accountId,
          inboxId: config.inboxId,
          latencyMs: result.latencyMs
        }
      });

      return { ...result, bot };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Error verificando conexión con Chatwoot.';

      if (bot && bot.driver === 'CHATWOOT') {
        bot.status = 'ERROR';
        bot.updatedAt = new Date().toISOString();
        runtimeStore.persistStateToDisk();
        void syncBotRecordToDb(bot);
        if (io) {
          io.to(`org:${bot.organizationId}`).emit('whatsapp:status', {
            botId: bot.id,
            status: bot.status,
            driver: bot.driver,
            lastError: errorMessage,
            updatedAt: bot.updatedAt
          });
        }
      }

      runtimeStore.appendLog({
        organizationId: bot?.organizationId,
        botId,
        level: 'ERROR',
        event: 'chatwoot.connection.failed',
        message: errorMessage,
        metadata: {
          accountId: config.accountId,
          inboxId: config.inboxId
        }
      });

      throw error;
    }
  }

  public static async listLabels(botId: string) {
    const config = runtimeStore.getChatwootConfigDto(botId);
    const secrets = runtimeStore.getDecryptedChatwootTokens(botId);

    if (!config || !secrets) {
      throw new Error('Este bot no tiene configuración de Chatwoot guardada.');
    }

    const labelToken = secrets.userApiAccessToken || secrets.apiAccessToken;
    if (!labelToken) {
      throw new Error('No hay token de acceso configurado para consultar Chatwoot.');
    }

    return fetchChatwootAccountLabelsApi({
      config,
      apiAccessToken: labelToken
    });
  }

  public static async processWebhookEvent(
    botId: string,
    providedToken: string | undefined,
    payload: ChatwootWebhookPayload,
    io?: SocketIOServer
  ): Promise<{
    accepted: boolean;
    action: string;
    conversation?: ConversationDto;
  }> {
    const bot = runtimeStore.bots.find((item) => item.id === botId);
    const config = runtimeStore.getChatwootConfigDto(botId);
    const secrets = runtimeStore.getDecryptedChatwootTokens(botId);

    if (!config || !secrets) {
      throw new ChatwootWebhookAuthError(
        'Token de webhook de Chatwoot ausente o no configurado.'
      );
    }

    if (!providedToken || !verifySecretConstantTime(providedToken, secrets.webhookToken)) {
      throw new ChatwootWebhookAuthError(
        'Token de webhook inválido o ausente (verificación en tiempo constante fallida).'
      );
    }

    if (!bot) {
      throw new Error(`Bot "${botId}" no encontrado para procesar webhook de Chatwoot.`);
    }

    if (payload.event === 'conversation_status_changed') {
      const targetConvId = payload.conversation?.id ?? payload.id;
      const nextRawStatus = (
        payload.conversation?.status ??
        payload.status ??
        ''
      ).toLowerCase();
      if (targetConvId) {
        const conv = runtimeStore.conversations.find(
          (item) =>
            item.botId === bot.id && item.chatwootConversationId === targetConvId
        );
        if (conv) {
          if (nextRawStatus === 'resolved') {
            conv.status = 'RESOLVED';
            conv.currentNodeId = null;
          } else if (nextRawStatus === 'pending') {
            conv.status = 'BOT_ACTIVE';
            conv.assignedAgentName = null;
            conv.handoffReason = null;
            conv.currentNodeId = null;
          } else if (nextRawStatus === 'open' && conv.status === 'BOT_ACTIVE') {
            conv.status = 'PENDING_AGENT';
          }
          conv.lastActivityAt = new Date().toISOString();
          runtimeStore.persistStateToDisk();
          const contact = runtimeStore.contacts.find((c) => c.id === conv.contactId);
          if (contact) {
            void syncConversationStateToDb(contact, conv);
          }
          if (io) {
            io.to(`org:${bot.organizationId}`).emit('conversation:updated', conv);
          }
          return {
            accepted: true,
            action: `conversation_status_${nextRawStatus || 'updated'}`,
            conversation: conv
          };
        }
      }
      return { accepted: true, action: `ignored_event_${payload.event}` };
    }

    if (payload.event && payload.event !== 'message_created') {
      return { accepted: true, action: `ignored_event_${payload.event}` };
    }

    if (payload.private) {
      return { accepted: true, action: 'ignored_private_note' };
    }

    const senderTypeLower = (payload.sender?.type ?? '').toLowerCase();
    if (senderTypeLower === 'agent_bot') {
      return { accepted: true, action: 'ignored_agent_bot_echo' };
    }

    const content = (payload.content ?? '').trim();
    if (!content) {
      return { accepted: true, action: 'ignored_empty_message' };
    }

    const isIncomingCustomerMessage =
      payload.message_type === 'incoming' ||
      payload.message_type === 0 ||
      senderTypeLower === 'contact';

    if (isIncomingCustomerMessage) {
      return processIncomingChatwootCustomerMessage(
        bot.id,
        config,
        secrets,
        payload,
        content,
        io
      );
    }

    const isOutgoingAgentMessage =
      payload.message_type === 'outgoing' || payload.message_type === 1;

    if (!isOutgoingAgentMessage) {
      return { accepted: true, action: 'ignored_non_agent_message' };
    }

    const chatwootConvId = payload.conversation?.id;
    const conversation = chatwootConvId
      ? runtimeStore.conversations.find(
          (item) =>
            item.botId === bot.id && item.chatwootConversationId === chatwootConvId
        )
      : runtimeStore.conversations.find((item) => item.botId === bot.id);

    if (!conversation) {
      return { accepted: true, action: 'no_matching_conversation' };
    }

    const returnCmd = secrets.handoffReturnCommand.toLowerCase();
    if (content.toLowerCase() === returnCmd || content.toLowerCase() === '#bot') {
      conversation.status = 'BOT_ACTIVE';
      conversation.assignedAgentName = null;
      conversation.handoffReason = null;
      conversation.currentNodeId = null;
      conversation.messages.push({
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        senderType: 'SYSTEM',
        senderName: 'Chatwoot Sync',
        content: `🤖 Comando "${secrets.handoffReturnCommand}" recibido desde Chatwoot. El bot ha retomado el control automático de la conversación.`,
        createdAt: new Date().toISOString()
      });
      conversation.lastActivityAt = new Date().toISOString();

      if (chatwootConvId) {
        await toggleChatwootConversationStatusApi({
          config,
          apiAccessToken: secrets.apiAccessToken,
          conversationId: chatwootConvId,
          status: 'pending'
        });
      }

      runtimeStore.appendLog({
        organizationId: bot.organizationId,
        botId: bot.id,
        level: 'INFO',
        event: 'chatwoot.handoff.returned_to_bot',
        message: `El agente devolvió la conversación ${conversation.id} al bot mediante comando ${secrets.handoffReturnCommand}.`
      });
      runtimeStore.persistStateToDisk();

      const contact = runtimeStore.contacts.find((c) => c.id === conversation.contactId);
      if (contact) {
        void syncConversationStateToDb(contact, conversation);
      }

      if (io) {
        io.to(`org:${bot.organizationId}`).emit('conversation:updated', conversation);
      }

      return {
        accepted: true,
        action: 'returned_to_bot',
        conversation
      };
    }

    const agentName = payload.sender?.name || 'Agente Chatwoot';
    conversation.status = 'AGENT_ACTIVE';
    conversation.assignedAgentName = agentName;
    conversation.messages.push({
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      senderType: 'AGENT',
      senderName: agentName,
      content,
      createdAt: new Date().toISOString()
    });
    conversation.lastMessagePreview = content;
    conversation.lastActivityAt = new Date().toISOString();

    if (
      outboundForwarder &&
      (bot.driver === 'BAILEYS' || bot.driver === 'CLOUD_API') &&
      conversation.contactPhone &&
      !conversation.contactPhone.startsWith('chatwoot-')
    ) {
      try {
        await outboundForwarder({
          botId: bot.id,
          toPhoneNumber: conversation.contactPhone,
          text: content
        });
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : 'Error reenviando mensaje de agente a WhatsApp';
        const errLog = runtimeStore.appendLog({
          organizationId: bot.organizationId,
          botId: bot.id,
          botName: bot.name,
          level: 'ERROR',
          event: 'chatwoot.outbound.error',
          message: `Fallo al reenviar mensaje de "${agentName}" hacia ${conversation.contactPhone}: ${errMsg}`
        });
        if (io) {
          io.to(`org:${bot.organizationId}`).emit('log:new', errLog);
        }
      }
    }

    runtimeStore.appendLog({
      organizationId: bot.organizationId,
      botId: bot.id,
      botName: bot.name,
      level: 'INFO',
      event: 'chatwoot.outbound.forwarded',
      message: `Mensaje de agente "${agentName}" en Chatwoot sincronizado (${conversation.contactPhone}).`
    });
    runtimeStore.persistStateToDisk();

    const contact = runtimeStore.contacts.find((c) => c.id === conversation.contactId);
    if (contact) {
      void syncConversationStateToDb(contact, conversation);
    }

    if (io) {
      io.to(`org:${bot.organizationId}`).emit('conversation:updated', conversation);
    }

    return {
      accepted: true,
      action: 'forwarded_to_whatsapp',
      conversation
    };
  }
}
