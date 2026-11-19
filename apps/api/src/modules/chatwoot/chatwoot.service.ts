import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import {
  ChatwootConfigDto,
  ChatwootConfigInput,
  ConversationDto
} from '@bothub/shared';
import { verifySecretConstantTime } from '../../lib/crypto.js';
import { runtimeStore } from '../../lib/runtime-store.js';
import {
  syncBotRecordToDb,
  syncChatwootSecretsToDb,
  syncConversationStateToDb
} from '../../lib/persistence.js';
import {
  executeFlowSimulationStep,
  resolveActiveFlowGraph
} from '../flows/flow.engine.js';
import {
  formatBotReplyForChatwoot,
  sendMessageToChatwootApi,
  toggleChatwootConversationStatusApi,
  verifyChatwootConnectionApi
} from './chatwoot.client.js';

export interface ChatwootWebhookPayload {
  event?: string;
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
    const resolvedInput: ChatwootConfigInput = {
      ...input,
      apiAccessToken:
        input.apiAccessToken.trim() || existingTokens?.apiAccessToken || '',
      webhookToken:
        input.webhookToken.trim() ||
        existingTokens?.webhookToken ||
        `whsec_${botId.replace(/[^a-zA-Z0-9]/g, '')}_2026`
    };

    runtimeStore.saveChatwootConfigForBot(botId, resolvedInput);
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
          io.emit('whatsapp:status', {
            botId: bot.id,
            status: bot.status,
            driver: bot.driver,
            updatedAt: bot.updatedAt
          });
        }
      }

      runtimeStore.appendLog({
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
          io.emit('whatsapp:status', {
            botId: bot.id,
            status: bot.status,
            driver: bot.driver,
            lastError: errorMessage,
            updatedAt: bot.updatedAt
          });
        }
      }

      runtimeStore.appendLog({
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
      throw new Error('Token de webhook de Chatwoot ausente o no configurado.');
    }

    if (providedToken) {
      const isWebhookTokenValid = verifySecretConstantTime(
        providedToken,
        secrets.webhookToken
      );
      const isApiTokenValid = verifySecretConstantTime(
        providedToken,
        secrets.apiAccessToken
      );
      if (!isWebhookTokenValid && !isApiTokenValid) {
        throw new Error(
          'Token de webhook inválido (verificación en tiempo constante fallida).'
        );
      }
    } else if (payload.account?.id !== config.accountId) {
      throw new Error('Token de webhook de Chatwoot ausente o no configurado.');
    }

    if (!bot) {
      throw new Error(`Bot "${botId}" no encontrado para procesar webhook de Chatwoot.`);
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
      return ChatwootService.handleIncomingCustomerMessage(
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
        botId: bot.id,
        level: 'INFO',
        event: 'chatwoot.handoff.returned_to_bot',
        message: `El agente devolvió la conversación ${conversation.id} al bot mediante comando ${secrets.handoffReturnCommand}.`
      });

      const contact = runtimeStore.contacts.find((c) => c.id === conversation.contactId);
      if (contact) {
        void syncConversationStateToDb(contact, conversation);
      }

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

    if (
      outboundForwarder &&
      (bot.driver === 'BAILEYS' || bot.driver === 'CLOUD_API') &&
      conversation.contactPhone &&
      !conversation.contactPhone.startsWith('chatwoot-')
    ) {
      await outboundForwarder({
        botId: bot.id,
        toPhoneNumber: conversation.contactPhone,
        text: content
      });
    }

    runtimeStore.appendLog({
      botId: bot.id,
      level: 'INFO',
      event: 'chatwoot.outbound.forwarded',
      message: `Mensaje de agente "${agentName}" en Chatwoot sincronizado (${conversation.contactPhone}).`
    });

    const contact = runtimeStore.contacts.find((c) => c.id === conversation.contactId);
    if (contact) {
      void syncConversationStateToDb(contact, conversation);
    }

    if (io) {
      io.emit('conversation:updated', conversation);
    }

    return {
      accepted: true,
      action: 'forwarded_to_whatsapp',
      conversation
    };
  }

  private static async handleIncomingCustomerMessage(
    botId: string,
    config: ChatwootConfigDto,
    secrets: {
      apiAccessToken: string;
      webhookToken: string;
      handoffReturnCommand: string;
    },
    payload: ChatwootWebhookPayload,
    content: string,
    io?: SocketIOServer
  ): Promise<{
    accepted: boolean;
    action: string;
    conversation?: ConversationDto;
  }> {
    const bot = runtimeStore.bots.find((item) => item.id === botId);
    if (!bot || bot.status === 'PAUSED' || !bot.isActive) {
      return { accepted: true, action: 'ignored_bot_paused' };
    }

    const chatwootConvId =
      payload.conversation?.id ?? crypto.randomInt(9000, 9999);
    const senderName =
      payload.sender?.name ||
      payload.conversation?.meta?.sender?.name ||
      'Cliente Chatwoot';
    const senderPhone =
      payload.sender?.phone_number ||
      payload.conversation?.meta?.sender?.phone_number ||
      payload.conversation?.contact_inbox?.source_id ||
      payload.sender?.email ||
      `chatwoot-${chatwootConvId}`;
    const senderChatwootId =
      payload.sender?.id ||
      payload.conversation?.meta?.sender?.id ||
      chatwootConvId;

    let contact = runtimeStore.contacts.find(
      (item) =>
        item.organizationId === bot.organizationId &&
        (item.chatwootContactId === senderChatwootId ||
          item.phoneNumber === senderPhone)
    );

    if (!contact) {
      contact = {
        id: `contact-${crypto.randomUUID().slice(0, 8)}`,
        organizationId: bot.organizationId,
        name: senderName,
        phoneNumber: senderPhone,
        email: payload.sender?.email ?? null,
        nationalId: null,
        chatwootContactId: senderChatwootId,
        tags: ['chatwoot-inbound'],
        variables: {
          nombre: senderName,
          telefono: senderPhone
        },
        conversationsCount: 1,
        lastInteractionAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      runtimeStore.contacts.unshift(contact);
    } else {
      contact.name = senderName || contact.name;
      contact.variables.nombre = contact.name;
    }

    const nowIso = new Date().toISOString();
    let conversation = runtimeStore.conversations.find(
      (item) =>
        item.botId === bot.id &&
        (item.chatwootConversationId === chatwootConvId ||
          item.contactId === contact.id)
    );

    if (!conversation) {
      conversation = {
        id: `conv-${crypto.randomUUID().slice(0, 8)}`,
        botId: bot.id,
        botName: bot.name,
        contactId: contact.id,
        contactName: contact.name,
        contactPhone: contact.phoneNumber,
        chatwootConversationId: chatwootConvId,
        status: 'BOT_ACTIVE',
        assignedAgentName: null,
        currentFlowName: bot.activeFlowName,
        currentNodeId: null,
        collectedVariables: contact.variables,
        tags: contact.tags,
        handoffReason: null,
        lastMessagePreview: content,
        lastActivityAt: nowIso,
        messages: [],
        executionTrace: []
      };
      runtimeStore.conversations.unshift(conversation);
    }

    conversation.messages.push({
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      senderType: 'CONTACT',
      senderName: contact.name,
      content,
      createdAt: nowIso
    });
    conversation.lastMessagePreview = content;
    conversation.lastActivityAt = nowIso;

    if (
      conversation.status === 'AGENT_ACTIVE' ||
      conversation.status === 'PENDING_AGENT'
    ) {
      runtimeStore.persistStateToDisk();
      void syncConversationStateToDb(contact, conversation);
      if (io) {
        io.emit('conversation:updated', conversation);
      }
      return {
        accepted: true,
        action: 'recorded_while_agent_active',
        conversation
      };
    }

    const matchedQuickReply = bot.quickReplies.find((qr) => {
      if (!qr.isActive) return false;
      const lowerInput = content.toLowerCase();
      return qr.keywords.some((kw) => {
        const lowerKw = kw.toLowerCase().trim();
        if (!lowerKw) return false;
        return qr.matchMode === 'EXACT'
          ? lowerInput === lowerKw
          : lowerInput.includes(lowerKw);
      });
    });

    if (matchedQuickReply) {
      const replyId = `reply-${crypto.randomUUID().slice(0, 8)}`;
      conversation.messages.push({
        id: replyId,
        senderType: 'BOT',
        senderName: bot.name,
        content: matchedQuickReply.responseText,
        createdAt: new Date().toISOString()
      });
      conversation.lastMessagePreview = matchedQuickReply.responseText;
      bot.messagesToday += 2;

      await sendMessageToChatwootApi({
        config,
        apiAccessToken: secrets.apiAccessToken,
        conversationId: chatwootConvId,
        content: matchedQuickReply.responseText
      });

      const logEntry = runtimeStore.appendLog({
        botId: bot.id,
        botName: bot.name,
        level: 'INFO',
        event: 'chatwoot.quick_reply.sent',
        message: `Respuesta rápida "${matchedQuickReply.title}" enviada a Chatwoot (Conv #${chatwootConvId}).`
      });
      void syncConversationStateToDb(contact, conversation);

      if (io) {
        io.emit('log:new', logEntry);
        io.emit('conversation:updated', conversation);
      }

      return {
        accepted: true,
        action: 'quick_reply_sent',
        conversation
      };
    }

    const flow =
      (bot.activeFlowId
        ? runtimeStore.flows.find(
            (item) =>
              item.id === bot.activeFlowId &&
              item.organizationId === bot.organizationId
          )
        : undefined) ??
      runtimeStore.flows.find(
        (item) =>
          item.organizationId === bot.organizationId &&
          item.botId === bot.id &&
          item.isMainMenu
      );

    if (!flow) {
      return {
        accepted: true,
        action: 'no_flow_assigned',
        conversation
      };
    }

    const activeGraph = resolveActiveFlowGraph(flow);
    const currentNode = activeGraph.nodes.find(
      (n) => n.id === conversation.currentNodeId
    );
    const isAwaitingInteractiveNode =
      currentNode?.type === 'QUESTION' ||
      currentNode?.type === 'BUTTONS' ||
      currentNode?.type === 'LIST';

    const simulation = await executeFlowSimulationStep(
      activeGraph.nodes,
      activeGraph.edges,
      {
        inputMessage: content,
        currentNodeId: conversation.currentNodeId,
        awaitingQuestionNodeId: isAwaitingInteractiveNode
          ? conversation.currentNodeId
          : null,
        variables: contact.variables,
        tags: contact.tags
      },
      { isLiveExecution: true }
    );

    contact.variables = simulation.variables;
    if (simulation.variables.cedula) {
      contact.nationalId = simulation.variables.cedula;
    }
    if (simulation.variables.correo || simulation.variables.email) {
      contact.email = simulation.variables.correo || simulation.variables.email;
    }
    contact.tags = simulation.tags;
    contact.lastInteractionAt = new Date().toISOString();

    conversation.currentFlowName = flow.name;
    conversation.currentNodeId = simulation.completed
      ? null
      : (simulation.awaitingQuestionNodeId ?? simulation.nextNodeId);
    conversation.collectedVariables = simulation.variables;
    conversation.tags = simulation.tags;
    conversation.executionTrace.push(...simulation.trace);

    for (const reply of simulation.replies) {
      const formattedText = formatBotReplyForChatwoot(reply);
      conversation.messages.push({
        id: reply.id,
        senderType: 'BOT',
        senderName: bot.name,
        content: formattedText,
        createdAt: new Date().toISOString()
      });
      conversation.lastMessagePreview = formattedText;

      const apiRes = await sendMessageToChatwootApi({
        config,
        apiAccessToken: secrets.apiAccessToken,
        conversationId: chatwootConvId,
        content: formattedText
      });

      if (!apiRes.sent && apiRes.errorDetail !== 'skipped_local_url') {
        const errLog = runtimeStore.appendLog({
          botId: bot.id,
          botName: bot.name,
          level: 'ERROR',
          event: 'chatwoot.api.error',
          message: `Error enviando respuesta a Chatwoot (${config.baseUrl}/api/v1/accounts/${config.accountId}/conversations/${chatwootConvId}/messages): ${apiRes.errorDetail}`,
          metadata: {
            chatwootConversationId: chatwootConvId,
            status: apiRes.status ?? null
          }
        });
        if (io) {
          io.emit('log:new', errLog);
        }
      }
    }

    if (simulation.handoffRequested) {
      conversation.status = 'PENDING_AGENT';
      conversation.handoffReason = simulation.handoffSummary;

      if (simulation.handoffSummary) {
        await sendMessageToChatwootApi({
          config,
          apiAccessToken: secrets.apiAccessToken,
          conversationId: chatwootConvId,
          content: simulation.handoffSummary,
          isPrivate: true
        });
      }

      await toggleChatwootConversationStatusApi({
        config,
        apiAccessToken: secrets.apiAccessToken,
        conversationId: chatwootConvId,
        status: 'open'
      });
    }

    bot.messagesToday += 1 + simulation.replies.length;
    conversation.lastActivityAt = new Date().toISOString();

    void syncConversationStateToDb(contact, conversation);

    const logEntry = runtimeStore.appendLog({
      botId: bot.id,
      botName: bot.name,
      level: 'INFO',
      event: 'chatwoot.bot.replied',
      message: `Flujo "${flow.name}" procesó mensaje de ${contact.name} en Chatwoot (Conv #${chatwootConvId}) con ${simulation.replies.length} respuesta(s).`,
      metadata: {
        chatwootConversationId: chatwootConvId,
        repliesCount: simulation.replies.length,
        handoffRequested: simulation.handoffRequested
      }
    });

    if (io) {
      io.emit('log:new', logEntry);
      io.emit('conversation:updated', conversation);
    }

    return {
      accepted: true,
      action: 'bot_flow_replied',
      conversation
    };
  }
}
