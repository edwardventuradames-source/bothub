import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import {
  BotDto,
  ConversationDto,
  FlowSimulationBotReply,
  FlowSimulationResponse
} from '@bothub/shared';
import { runtimeStore } from '../../lib/runtime-store.js';
import { syncConversationStateToDb } from '../../lib/persistence.js';
import {
  executeFlowSimulationStep,
  resolveActiveFlowGraph
} from '../flows/flow.engine.js';
import {
  formatBotReplyForChatwoot,
  sendMessageToChatwootApi,
  toggleChatwootConversationStatusApi
} from '../chatwoot/chatwoot.client.js';

export interface InboundWhatsAppMessageParams {
  botId: string;
  fromPhone: string;
  contactName: string;
  text: string;
  io?: SocketIOServer;
  sendReply?: (reply: FlowSimulationBotReply) => Promise<void>;
  onTyping?: (delayMs: number) => Promise<void>;
}

export interface InboundWhatsAppResult {
  accepted: boolean;
  action: string;
  conversation?: ConversationDto;
  simulation?: FlowSimulationResponse;
}

export class BotNotFoundError extends Error {
  constructor(botId: string) {
    super(`Bot "${botId}" no encontrado.`);
    this.name = 'BotNotFoundError';
  }
}

function matchQuickReply(bot: BotDto, content: string) {
  const lowerInput = content.trim().toLowerCase();
  return bot.quickReplies.find((qr) => {
    if (!qr.isActive) return false;
    return qr.keywords.some((kw) => {
      const lowerKw = kw.toLowerCase().trim();
      if (!lowerKw) return false;
      if (qr.matchMode === 'EXACT') {
        return lowerInput === lowerKw;
      }
      if (qr.matchMode === 'REGEX') {
        try {
          return new RegExp(kw, 'i').test(content.trim());
        } catch {
          return false;
        }
      }
      return lowerInput.includes(lowerKw);
    });
  });
}

async function mirrorReplyToChatwootIfConfigured(
  bot: BotDto,
  conversation: ConversationDto,
  content: string,
  options: { isPrivate?: boolean; messageType?: 'incoming' | 'outgoing' } = {}
): Promise<void> {
  const cwConfig = runtimeStore.getChatwootConfigDto(bot.id);
  const cwSecrets = runtimeStore.getDecryptedChatwootTokens(bot.id);
  if (!cwConfig || !cwSecrets || !cwConfig.isActive || !conversation.chatwootConversationId) {
    return;
  }

  await sendMessageToChatwootApi({
    config: cwConfig,
    apiAccessToken: cwSecrets.apiAccessToken,
    conversationId: conversation.chatwootConversationId,
    content,
    isPrivate: options.isPrivate,
    messageType: options.messageType
  });
}

export async function processInboundWhatsAppMessage(
  params: InboundWhatsAppMessageParams
): Promise<InboundWhatsAppResult> {
  const bot = runtimeStore.bots.find((item) => item.id === params.botId);
  if (!bot) {
    throw new BotNotFoundError(params.botId);
  }

  if (bot.status === 'PAUSED' || !bot.isActive) {
    return { accepted: true, action: 'ignored_bot_paused' };
  }

  const trimmedText = params.text.trim();
  if (!trimmedText) {
    return { accepted: true, action: 'ignored_empty_message' };
  }

  let contact = runtimeStore.contacts.find(
    (item) =>
      item.organizationId === bot.organizationId &&
      item.phoneNumber === params.fromPhone
  );

  const nowIso = new Date().toISOString();

  if (!contact) {
    contact = {
      id: `contact-${crypto.randomUUID().slice(0, 8)}`,
      organizationId: bot.organizationId,
      name: params.contactName || params.fromPhone,
      phoneNumber: params.fromPhone,
      email: null,
      nationalId: null,
      chatwootContactId: null,
      tags: ['whatsapp-inbound'],
      variables: {
        nombre: params.contactName || params.fromPhone,
        telefono: params.fromPhone
      },
      conversationsCount: 1,
      lastInteractionAt: nowIso,
      createdAt: nowIso
    };
    runtimeStore.contacts.unshift(contact);
  } else {
    if (params.contactName && params.contactName !== 'Cliente WhatsApp Cloud') {
      contact.name = params.contactName;
      contact.variables.nombre = params.contactName;
    }
    contact.lastInteractionAt = nowIso;
  }

  let conversation = runtimeStore.conversations.find(
    (item) => item.botId === bot.id && item.contactId === contact.id
  );

  if (!conversation) {
    conversation = {
      id: `conv-${crypto.randomUUID().slice(0, 8)}`,
      botId: bot.id,
      botName: bot.name,
      contactId: contact.id,
      contactName: contact.name,
      contactPhone: contact.phoneNumber,
      chatwootConversationId: null,
      status: 'BOT_ACTIVE',
      assignedAgentName: null,
      currentFlowName: bot.activeFlowName,
      currentNodeId: null,
      collectedVariables: contact.variables,
      tags: contact.tags,
      handoffReason: null,
      lastMessagePreview: trimmedText,
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
    content: trimmedText,
    createdAt: nowIso
  });
  conversation.lastMessagePreview = trimmedText;
  conversation.lastActivityAt = nowIso;

  if (
    conversation.status === 'AGENT_ACTIVE' ||
    conversation.status === 'PENDING_AGENT'
  ) {
    await mirrorReplyToChatwootIfConfigured(bot, conversation, trimmedText, {
      messageType: 'incoming'
    });
    runtimeStore.persistStateToDisk();
    void syncConversationStateToDb(contact, conversation);
    if (params.io) {
      params.io.to(`org:${bot.organizationId}`).emit('conversation:updated', conversation);
    }
    return {
      accepted: true,
      action: 'recorded_while_agent_active',
      conversation
    };
  }

  await mirrorReplyToChatwootIfConfigured(bot, conversation, trimmedText, {
    messageType: 'incoming'
  });

  const matchedQuickReply = matchQuickReply(bot, trimmedText);
  if (matchedQuickReply) {
    const reply: FlowSimulationBotReply = {
      id: `reply-${crypto.randomUUID().slice(0, 8)}`,
      text: matchedQuickReply.responseText
    };
    if (params.sendReply) {
      await params.sendReply(reply);
    }
    await mirrorReplyToChatwootIfConfigured(bot, conversation, reply.text);

    conversation.messages.push({
      id: reply.id,
      senderType: 'BOT',
      senderName: bot.name,
      content: reply.text,
      createdAt: new Date().toISOString()
    });
    conversation.lastMessagePreview = reply.text;
    conversation.lastActivityAt = new Date().toISOString();
    bot.messagesToday += 2;

    const logEntry = runtimeStore.appendLog({
      botId: bot.id,
      botName: bot.name,
      level: 'INFO',
      event: 'whatsapp.quick_reply.sent',
      message: `Respuesta rápida "${matchedQuickReply.title}" enviada a ${contact.phoneNumber}.`
    });
    void syncConversationStateToDb(contact, conversation);

    if (params.io) {
      params.io.to(`org:${bot.organizationId}`).emit('log:new', logEntry);
      params.io.to(`org:${bot.organizationId}`).emit('conversation:updated', conversation);
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
    runtimeStore.persistStateToDisk();
    void syncConversationStateToDb(contact, conversation);
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
      inputMessage: trimmedText,
      currentNodeId: conversation.currentNodeId,
      awaitingQuestionNodeId: isAwaitingInteractiveNode
        ? conversation.currentNodeId
        : null,
      variables: contact.variables,
      tags: contact.tags
    },
    {
      isLiveExecution: true,
      onTyping: params.onTyping
    }
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
    if (params.sendReply) {
      await params.sendReply(reply);
    }
    const formatted = formatBotReplyForChatwoot(reply);
    await mirrorReplyToChatwootIfConfigured(bot, conversation, formatted);

    conversation.messages.push({
      id: reply.id,
      senderType: 'BOT',
      senderName: bot.name,
      content: formatted,
      mediaUrl: reply.mediaUrl,
      createdAt: new Date().toISOString()
    });
  }

  if (simulation.handoffRequested) {
    conversation.status = 'PENDING_AGENT';
    conversation.handoffReason = simulation.handoffSummary;

    if (simulation.handoffSummary) {
      await mirrorReplyToChatwootIfConfigured(
        bot,
        conversation,
        simulation.handoffSummary,
        { isPrivate: true }
      );
    }

    const cwConfig = runtimeStore.getChatwootConfigDto(bot.id);
    const cwSecrets = runtimeStore.getDecryptedChatwootTokens(bot.id);
    if (cwConfig && cwSecrets && conversation.chatwootConversationId) {
      await toggleChatwootConversationStatusApi({
        config: cwConfig,
        apiAccessToken: cwSecrets.apiAccessToken,
        conversationId: conversation.chatwootConversationId,
        status: 'open'
      });
    }
  }

  bot.messagesToday += 1 + simulation.replies.length;
  conversation.lastMessagePreview =
    simulation.replies[simulation.replies.length - 1]?.text ?? trimmedText;
  conversation.lastActivityAt = new Date().toISOString();

  const logEntry = runtimeStore.appendLog({
    botId: bot.id,
    botName: bot.name,
    level: 'INFO',
    event: 'whatsapp.message.processed',
    message: `Mensaje de ${contact.name} (${contact.phoneNumber}) procesado por flujo "${flow.name}".`,
    metadata: {
      repliesCount: simulation.replies.length,
      handoffRequested: simulation.handoffRequested,
      currentNodeId: conversation.currentNodeId
    }
  });

  void syncConversationStateToDb(contact, conversation);

  if (params.io) {
    params.io.to(`org:${bot.organizationId}`).emit('log:new', logEntry);
    params.io.to(`org:${bot.organizationId}`).emit('conversation:updated', conversation);
  }

  return {
    accepted: true,
    action: 'bot_flow_replied',
    conversation,
    simulation
  };
}
