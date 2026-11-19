import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import {
  BotDto,
  ContactDto,
  ConversationDto,
  FlowSimulationBotReply,
  FlowSimulationResponse
} from '@bothub/shared';
import {
  isBotContactRateLimited,
  isDuplicateInboundMessage,
  isWithinBotBusinessHours,
  matchBotQuickReply
} from '../../lib/bot-runtime-utils.js';
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
import { syncAssignedFlowLabelsToChatwoot } from '../chatwoot/chatwoot-labels.js';

export interface InboundWhatsAppMessageParams {
  botId: string;
  fromPhone: string;
  contactName: string;
  text: string;
  externalMessageId?: string;
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

async function deliverWhatsAppReply(
  bot: BotDto,
  contact: ContactDto,
  reply: FlowSimulationBotReply,
  sendReply: ((reply: FlowSimulationBotReply) => Promise<void>) | undefined,
  io: SocketIOServer | undefined
): Promise<boolean> {
  if (!sendReply) {
    return true;
  }
  try {
    await sendReply(reply);
    return true;
  } catch (err) {
    const errMessage =
      err instanceof Error ? err.message : 'Error entregando mensaje saliente.';
    const errLog = runtimeStore.appendLog({
      organizationId: bot.organizationId,
      botId: bot.id,
      botName: bot.name,
      level: 'ERROR',
      event: 'whatsapp.send.error',
      message: `Fallo enviando respuesta a ${contact.phoneNumber}: ${errMessage}`,
      metadata: {
        replyId: reply.id,
        toPhone: contact.phoneNumber
      }
    });
    if (io) {
      io.to(`org:${bot.organizationId}`).emit('log:new', errLog);
    }
    return false;
  }
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

  try {
    await sendMessageToChatwootApi({
      config: cwConfig,
      apiAccessToken: cwSecrets.apiAccessToken,
      conversationId: conversation.chatwootConversationId,
      content,
      isPrivate: options.isPrivate,
      messageType: options.messageType
    });
  } catch {
    void 0;
  }
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

  if (
    params.externalMessageId &&
    isDuplicateInboundMessage(`wa:${bot.id}:${params.externalMessageId}`)
  ) {
    return { accepted: true, action: 'duplicate_message_ignored' };
  }

  if (isBotContactRateLimited(bot.id, params.fromPhone, bot.rateLimitPerMinute)) {
    const rateLog = runtimeStore.appendLog({
      organizationId: bot.organizationId,
      botId: bot.id,
      botName: bot.name,
      level: 'WARN',
      event: 'whatsapp.rate_limited',
      message: `Límite de mensajes por minuto excedido para ${params.fromPhone}.`,
      metadata: {
        fromPhone: params.fromPhone,
        rateLimitPerMinute: bot.rateLimitPerMinute
      }
    });
    if (params.io) {
      params.io.to(`org:${bot.organizationId}`).emit('log:new', rateLog);
    }
    return { accepted: true, action: 'rate_limited' };
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
      collectedVariables: { ...contact.variables },
      tags: [...contact.tags],
      handoffReason: null,
      lastMessagePreview: trimmedText,
      lastActivityAt: nowIso,
      messages: [],
      executionTrace: []
    };
    runtimeStore.conversations.unshift(conversation);
  } else if (conversation.status === 'RESOLVED') {
    conversation.status = 'BOT_ACTIVE';
    conversation.assignedAgentName = null;
    conversation.handoffReason = null;
    conversation.currentNodeId = null;
    contact.conversationsCount += 1;
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

  if (!isWithinBotBusinessHours(bot)) {
    const outOfHoursReply: FlowSimulationBotReply = {
      id: `reply-${crypto.randomUUID().slice(0, 8)}`,
      text:
        bot.outOfHoursMessage ||
        'Gracias por comunicarte. En este momento estamos fuera de horario.'
    };
    await deliverWhatsAppReply(
      bot,
      contact,
      outOfHoursReply,
      params.sendReply,
      params.io
    );
    await mirrorReplyToChatwootIfConfigured(bot, conversation, outOfHoursReply.text);

    const outIso = new Date().toISOString();
    conversation.messages.push({
      id: outOfHoursReply.id,
      senderType: 'BOT',
      senderName: bot.name,
      content: outOfHoursReply.text,
      createdAt: outIso
    });
    conversation.lastMessagePreview = outOfHoursReply.text;
    conversation.lastActivityAt = outIso;
    bot.messagesToday += 2;

    const logEntry = runtimeStore.appendLog({
      organizationId: bot.organizationId,
      botId: bot.id,
      botName: bot.name,
      level: 'INFO',
      event: 'whatsapp.out_of_hours',
      message: `Mensaje fuera de horario respondido a ${contact.phoneNumber}.`
    });
    runtimeStore.persistStateToDisk();
    void syncConversationStateToDb(contact, conversation);

    if (params.io) {
      params.io.to(`org:${bot.organizationId}`).emit('log:new', logEntry);
      params.io.to(`org:${bot.organizationId}`).emit('conversation:updated', conversation);
    }

    return {
      accepted: true,
      action: 'out_of_hours_replied',
      conversation
    };
  }

  const matchedQuickReply = matchBotQuickReply(bot, trimmedText);
  if (matchedQuickReply) {
    const reply: FlowSimulationBotReply = {
      id: `reply-${crypto.randomUUID().slice(0, 8)}`,
      text: matchedQuickReply.responseText
    };
    await deliverWhatsAppReply(
      bot,
      contact,
      reply,
      params.sendReply,
      params.io
    );
    await mirrorReplyToChatwootIfConfigured(bot, conversation, reply.text);

    const replyIso = new Date().toISOString();
    conversation.messages.push({
      id: reply.id,
      senderType: 'BOT',
      senderName: bot.name,
      content: reply.text,
      createdAt: replyIso
    });
    conversation.lastMessagePreview = reply.text;
    conversation.lastActivityAt = replyIso;
    bot.messagesToday += 2;

    const logEntry = runtimeStore.appendLog({
      organizationId: bot.organizationId,
      botId: bot.id,
      botName: bot.name,
      level: 'INFO',
      event: 'whatsapp.quick_reply.sent',
      message: `Respuesta rápida "${matchedQuickReply.title}" enviada a ${contact.phoneNumber}.`
    });
    runtimeStore.persistStateToDisk();
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
  let currentNode = conversation.currentNodeId
    ? activeGraph.nodes.find((n) => n.id === conversation.currentNodeId)
    : undefined;
  if (conversation.currentNodeId && !currentNode) {
    conversation.currentNodeId = null;
    currentNode = undefined;
  }
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
      variables: { ...contact.variables },
      tags: [...contact.tags]
    },
    {
      isLiveExecution: true,
      onTyping: params.onTyping
    }
  );

  contact.variables = { ...simulation.variables };
  if (simulation.variables.cedula) {
    contact.nationalId = simulation.variables.cedula;
  }
  if (simulation.variables.correo || simulation.variables.email) {
    contact.email = simulation.variables.correo || simulation.variables.email;
  }
  contact.tags = [...simulation.tags];
  contact.lastInteractionAt = new Date().toISOString();

  conversation.currentFlowName = flow.name;
  conversation.currentNodeId = simulation.completed
    ? null
    : (simulation.awaitingQuestionNodeId ?? simulation.nextNodeId);
  conversation.collectedVariables = { ...simulation.variables };
  conversation.tags = [...simulation.tags];
  conversation.executionTrace.push(...simulation.trace);

  const cwConfig = runtimeStore.getChatwootConfigDto(bot.id);
  const cwSecrets = runtimeStore.getDecryptedChatwootTokens(bot.id);
  if (cwConfig && cwSecrets && cwConfig.isActive && conversation.chatwootConversationId) {
    await syncAssignedFlowLabelsToChatwoot({
      bot,
      config: cwConfig,
      apiAccessToken: cwSecrets.apiAccessToken,
      userApiAccessToken: cwSecrets.userApiAccessToken,
      chatwootConvId: conversation.chatwootConversationId,
      assignedTags: simulation.assignedTags,
      io: params.io
    });
  }

  for (const reply of simulation.replies) {
    await deliverWhatsAppReply(
      bot,
      contact,
      reply,
      params.sendReply,
      params.io
    );
    const formatted = formatBotReplyForChatwoot(reply);
    await mirrorReplyToChatwootIfConfigured(bot, conversation, formatted);

    conversation.messages.push({
      id: reply.id,
      senderType: 'BOT',
      senderName: bot.name,
      content: formatted,
      mediaUrl: reply.mediaUrl,
      mediaType: reply.mediaType,
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
      try {
        await toggleChatwootConversationStatusApi({
          config: cwConfig,
          apiAccessToken: cwSecrets.apiAccessToken,
          conversationId: conversation.chatwootConversationId,
          status: 'open'
        });
      } catch {
        void 0;
      }
    }
  }

  bot.messagesToday += 1 + simulation.replies.length;
  conversation.lastMessagePreview =
    simulation.replies[simulation.replies.length - 1]?.text ?? trimmedText;
  conversation.lastActivityAt = new Date().toISOString();

  const logEntry = runtimeStore.appendLog({
    organizationId: bot.organizationId,
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

  runtimeStore.persistStateToDisk();
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
