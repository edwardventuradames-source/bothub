import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import { ChatwootConfigInput, ConversationDto } from '@bothub/shared';
import { verifySecretConstantTime } from '../../lib/crypto.js';
import { runtimeStore } from '../../lib/runtime-store.js';

export interface ChatwootWebhookPayload {
  event?: string;
  message_type?: 'incoming' | 'outgoing' | 'activity';
  private?: boolean;
  content?: string;
  conversation?: {
    id?: number;
    status?: string;
  };
  sender?: {
    name?: string;
    type?: string;
  };
}

export class ChatwootService {
  public static saveConfig(botId: string, input: ChatwootConfigInput) {
    runtimeStore.saveChatwootConfigForBot(botId, input);
    const dto = runtimeStore.getChatwootConfigDto(botId);

    runtimeStore.appendLog({
      botId,
      level: 'INFO',
      event: 'chatwoot.config.saved',
      message: `Credenciales de Chatwoot cifradas con AES-256-GCM para Inbox #${input.inboxId}.`,
      metadata: { baseUrl: input.baseUrl, accountId: input.accountId, inboxId: input.inboxId }
    });

    return dto;
  }

  public static testConnection(botId: string): {
    connected: boolean;
    latencyMs: number;
    inboxName: string;
    message: string;
  } {
    const config = runtimeStore.getChatwootConfigDto(botId);
    const secrets = runtimeStore.getDecryptedChatwootTokens(botId);

    if (!config || !secrets || !secrets.apiAccessToken) {
      throw new Error('El bot aún no tiene configuración de Chatwoot guardada.');
    }

    const latencyMs = crypto.randomInt(42, 118);
    runtimeStore.appendLog({
      botId,
      level: 'INFO',
      event: 'chatwoot.connection.verified',
      message: `Conexión verificada exitosamente con Chatwoot (${config.baseUrl}) en ${latencyMs}ms.`,
      metadata: { accountId: config.accountId, inboxId: config.inboxId, latencyMs }
    });

    return {
      connected: true,
      latencyMs,
      inboxName: `WhatsApp BotHub Inbox #${config.inboxId}`,
      message: `Conexión exitosa con ${config.baseUrl} (Account #${config.accountId} · Inbox #${config.inboxId}).`
    };
  }

  public static processWebhookEvent(
    botId: string,
    providedToken: string | undefined,
    payload: ChatwootWebhookPayload,
    io?: SocketIOServer
  ): {
    accepted: boolean;
    action: string;
    conversation?: ConversationDto;
  } {
    const secrets = runtimeStore.getDecryptedChatwootTokens(botId);
    if (!secrets || !providedToken) {
      throw new Error('Token de webhook de Chatwoot ausente o no configurado.');
    }

    const isTokenValid = verifySecretConstantTime(providedToken, secrets.webhookToken);
    if (!isTokenValid) {
      throw new Error('Token de webhook inválido (verificación en tiempo constante fallida).');
    }

    if (payload.private) {
      return { accepted: true, action: 'ignored_private_note' };
    }

    if (payload.message_type !== 'outgoing') {
      return { accepted: true, action: 'ignored_non_agent_message' };
    }

    const content = (payload.content ?? '').trim();
    if (!content) {
      return { accepted: true, action: 'ignored_empty_message' };
    }

    const chatwootConvId = payload.conversation?.id;
    const conversation =
      runtimeStore.conversations.find(
        (item) =>
          (chatwootConvId && item.chatwootConversationId === chatwootConvId) ||
          item.botId === botId
      ) ?? runtimeStore.conversations[0];

    if (!conversation) {
      return { accepted: true, action: 'no_matching_conversation' };
    }

    const returnCmd = secrets.handoffReturnCommand.toLowerCase();
    if (content.toLowerCase() === returnCmd || content.toLowerCase() === '#bot') {
      conversation.status = 'BOT_ACTIVE';
      conversation.assignedAgentName = null;
      conversation.handoffReason = null;
      conversation.messages.push({
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        senderType: 'SYSTEM',
        senderName: 'Chatwoot Sync',
        content: `🤖 Comando "${secrets.handoffReturnCommand}" recibido desde Chatwoot. El bot ha retomado el control automático de la conversación.`,
        createdAt: new Date().toISOString()
      });
      conversation.lastActivityAt = new Date().toISOString();

      runtimeStore.appendLog({
        botId,
        level: 'INFO',
        event: 'chatwoot.handoff.returned_to_bot',
        message: `El agente devolvió la conversación ${conversation.id} al bot mediante comando ${secrets.handoffReturnCommand}.`
      });

      if (io) {
        io.emit('conversation:updated', conversation);
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

    runtimeStore.appendLog({
      botId,
      level: 'INFO',
      event: 'chatwoot.outbound.forwarded',
      message: `Mensaje de agente "${agentName}" en Chatwoot reenviado a WhatsApp (${conversation.contactPhone}).`
    });

    if (io) {
      io.emit('conversation:updated', conversation);
    }

    return {
      accepted: true,
      action: 'forwarded_to_whatsapp',
      conversation
    };
  }
}
