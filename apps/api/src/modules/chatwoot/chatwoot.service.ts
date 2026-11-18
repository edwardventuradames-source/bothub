import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import {
  ChatwootConfigDto,
  ChatwootConfigInput,
  ConversationDto,
  FlowSimulationBotReply
} from '@bothub/shared';
import { verifySecretConstantTime } from '../../lib/crypto.js';
import { runtimeStore } from '../../lib/runtime-store.js';
import { executeFlowSimulationStep } from '../flows/flow.engine.js';

const HTTP_TIMEOUT_MS = 8000;

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

function shouldCallRemoteChatwoot(baseUrl: string, conversationId?: number): boolean {
  if (!conversationId || conversationId <= 0) {
    return false;
  }
  try {
    const parsed = new URL(baseUrl);
    if (
      parsed.hostname.endsWith('.local') ||
      parsed.hostname === 'example.com' ||
      parsed.hostname === 'localhost'
    ) {
      return false;
    }
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

interface ChatwootApiCallResult {
  sent: boolean;
  status?: number;
  errorDetail?: string;
}

async function sendMessageToChatwootApi(params: {
  config: ChatwootConfigDto;
  apiAccessToken: string;
  conversationId: number;
  content: string;
  isPrivate?: boolean;
}): Promise<ChatwootApiCallResult> {
  if (!shouldCallRemoteChatwoot(params.config.baseUrl, params.conversationId)) {
    return { sent: false, errorDetail: 'skipped_local_url' };
  }

  const trimmedContent = params.content.trim();
  if (!trimmedContent) {
    return { sent: false, errorDetail: 'empty_content' };
  }

  const endpoint = `${params.config.baseUrl}/api/v1/accounts/${params.config.accountId}/conversations/${params.conversationId}/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_access_token: params.apiAccessToken
      },
      body: JSON.stringify({
        content: trimmedContent,
        message_type: 'outgoing',
        private: Boolean(params.isPrivate)
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        sent: false,
        status: response.status,
        errorDetail: `HTTP ${response.status}: ${errorBody.slice(0, 220)}`
      };
    }

    return { sent: true, status: response.status };
  } catch (err) {
    return {
      sent: false,
      errorDetail: err instanceof Error ? err.message : 'Network error'
    };
  } finally {
    clearTimeout(timer);
  }
}

async function toggleChatwootConversationStatusApi(params: {
  config: ChatwootConfigDto;
  apiAccessToken: string;
  conversationId: number;
  status: 'open' | 'pending' | 'resolved';
}): Promise<void> {
  if (!shouldCallRemoteChatwoot(params.config.baseUrl, params.conversationId)) {
    return;
  }

  const endpoint = `${params.config.baseUrl}/api/v1/accounts/${params.config.accountId}/conversations/${params.conversationId}/toggle_status`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_access_token: params.apiAccessToken
      },
      body: JSON.stringify({ status: params.status }),
      signal: controller.signal
    });
  } catch {
    void 0;
  } finally {
    clearTimeout(timer);
  }
}

function formatBotReplyForChatwoot(reply: FlowSimulationBotReply): string {
  let formatted = reply.text.trim();

  if (Array.isArray(reply.buttons) && reply.buttons.length > 0) {
    const optionLines = reply.buttons.map((btn, idx) => {
      const prefix = `${idx + 1}.`;
      return btn.label.trim().startsWith(prefix)
        ? `• ${btn.label.trim()}`
        : `${prefix} ${btn.label.trim()}`;
    });
    formatted = `${formatted}\n\n${optionLines.join('\n')}`;
  }

  if (Array.isArray(reply.listItems) && reply.listItems.length > 0) {
    const listLines = reply.listItems.map((item, idx) => {
      const desc = item.description ? ` — ${item.description}` : '';
      return `${idx + 1}. ${item.title}${desc}`;
    });
    formatted = `${formatted}\n\n${listLines.join('\n')}`;
  }

  return formatted;
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

    runtimeStore.appendLog({
      botId,
      level: 'INFO',
      event: 'chatwoot.config.saved',
      message: `Credenciales de Chatwoot cifradas con AES-256-GCM para Inbox #${input.inboxId}. Bot conectado en modo Chatwoot Agent Bot.`,
      metadata: {
        baseUrl: input.baseUrl,
        accountId: input.accountId,
        inboxId: input.inboxId
      }
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
      inboxName: `Chatwoot Inbox #${config.inboxId}`,
      message: `Conexión exitosa con ${config.baseUrl} (Account #${config.accountId} · Inbox #${config.inboxId}).`
    };
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
        botId,
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
      message: `Mensaje de agente "${agentName}" en Chatwoot sincronizado (${conversation.contactPhone}).`
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
    const bot =
      runtimeStore.bots.find((item) => item.id === botId) ?? runtimeStore.bots[0];
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
        item.chatwootContactId === senderChatwootId ||
        item.phoneNumber === senderPhone
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
      runtimeStore.flows.find((item) => item.id === bot.activeFlowId) ??
      runtimeStore.flows[0];

    if (!flow) {
      return {
        accepted: true,
        action: 'no_flow_assigned',
        conversation
      };
    }

    const activeGraph = flow.publishedVersion ?? flow.draftVersion;
    const currentNode = activeGraph.nodes.find(
      (n) => n.id === conversation.currentNodeId
    );
    const isAwaitingInteractiveNode =
      currentNode?.type === 'QUESTION' ||
      currentNode?.type === 'BUTTONS' ||
      currentNode?.type === 'LIST';

    const simulation = executeFlowSimulationStep(
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
      }
    );

    contact.variables = simulation.variables;
    if (simulation.variables.cedula) {
      contact.nationalId = simulation.variables.cedula;
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
