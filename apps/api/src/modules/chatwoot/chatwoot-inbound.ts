import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import {
  BotDto,
  ChatwootConfigDto,
  ConversationDto
} from '@bothub/shared';
import {
  isBotContactRateLimited,
  isDuplicateInboundMessage,
  isWithinBotBusinessHours,
  matchBotQuickReply,
  resolveInterReplyWaitMs,
  waitOutgoingPacingMs
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
  shouldCallRemoteChatwoot,
  toggleChatwootConversationStatusApi
} from './chatwoot.client.js';
import { syncAssignedFlowLabelsToChatwoot } from './chatwoot-labels.js';
import type { ChatwootWebhookPayload } from './chatwoot.service.js';

async function sendToChatwootWithLog(params: {
  bot: BotDto;
  config: ChatwootConfigDto;
  apiAccessToken: string;
  chatwootConvId: number;
  content: string;
  reply?: Parameters<typeof sendMessageToChatwootApi>[0]['reply'];
  isPrivate?: boolean;
  io?: SocketIOServer;
}): Promise<void> {
  const apiRes = await sendMessageToChatwootApi({
    config: params.config,
    apiAccessToken: params.apiAccessToken,
    conversationId: params.chatwootConvId,
    content: params.content,
    reply: params.reply,
    isPrivate: params.isPrivate
  });

  if (!apiRes.sent && apiRes.errorDetail !== 'skipped_local_url') {
    const errLog = runtimeStore.appendLog({
      organizationId: params.bot.organizationId,
      botId: params.bot.id,
      botName: params.bot.name,
      level: 'ERROR',
      event: 'chatwoot.api.error',
      message: `Error enviando respuesta a Chatwoot (${params.config.baseUrl}/api/v1/accounts/${params.config.accountId}/conversations/${params.chatwootConvId}/messages): ${apiRes.errorDetail}`,
      metadata: {
        chatwootConversationId: params.chatwootConvId,
        status: apiRes.status ?? null
      }
    });
    if (params.io) {
      params.io.to(`org:${params.bot.organizationId}`).emit('log:new', errLog);
    }
  }
}

export async function processIncomingChatwootCustomerMessage(
  botId: string,
  config: ChatwootConfigDto,
  secrets: {
    apiAccessToken: string;
    userApiAccessToken?: string | null;
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

  if (
    payload.id !== undefined &&
    isDuplicateInboundMessage(`cw:${bot.id}:${payload.id}`)
  ) {
    return { accepted: true, action: 'duplicate_message_ignored' };
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

  if (isBotContactRateLimited(bot.id, senderPhone, bot.rateLimitPerMinute)) {
    const rateLog = runtimeStore.appendLog({
      organizationId: bot.organizationId,
      botId: bot.id,
      botName: bot.name,
      level: 'WARN',
      event: 'chatwoot.rate_limited',
      message: `Límite de mensajes por minuto excedido para ${senderPhone} en Chatwoot.`,
      metadata: {
        chatwootConversationId: chatwootConvId,
        senderPhone
      }
    });
    if (io) {
      io.to(`org:${bot.organizationId}`).emit('log:new', rateLog);
    }
    return { accepted: true, action: 'rate_limited' };
  }

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
        (item.chatwootConversationId == null && item.contactId === contact.id))
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
      collectedVariables: { ...contact.variables },
      tags: [...contact.tags],
      handoffReason: null,
      lastMessagePreview: content,
      lastActivityAt: nowIso,
      messages: [],
      executionTrace: []
    };
    runtimeStore.conversations.unshift(conversation);
  } else {
    conversation.chatwootConversationId = chatwootConvId;
    const chatwootConvStatus = (payload.conversation?.status ?? '').toLowerCase();
    if (
      conversation.status === 'RESOLVED' ||
      (chatwootConvStatus === 'pending' &&
        (conversation.status === 'AGENT_ACTIVE' ||
          conversation.status === 'PENDING_AGENT'))
    ) {
      conversation.status = 'BOT_ACTIVE';
      conversation.assignedAgentName = null;
      conversation.handoffReason = null;
      conversation.currentNodeId = null;
      contact.conversationsCount += 1;
    }
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
      io.to(`org:${bot.organizationId}`).emit('conversation:updated', conversation);
    }
    return {
      accepted: true,
      action: 'recorded_while_agent_active',
      conversation
    };
  }

  if (!isWithinBotBusinessHours(bot)) {
    const outMessage =
      bot.outOfHoursMessage ||
      'Gracias por comunicarte. En este momento estamos fuera de horario.';
    const replyId = `reply-${crypto.randomUUID().slice(0, 8)}`;
    const replyIso = new Date().toISOString();
    conversation.messages.push({
      id: replyId,
      senderType: 'BOT',
      senderName: bot.name,
      content: outMessage,
      createdAt: replyIso
    });
    conversation.lastMessagePreview = outMessage;
    conversation.lastActivityAt = replyIso;
    bot.messagesToday += 2;

    await sendToChatwootWithLog({
      bot,
      config,
      apiAccessToken: secrets.apiAccessToken,
      chatwootConvId,
      content: outMessage,
      io
    });

    const logEntry = runtimeStore.appendLog({
      organizationId: bot.organizationId,
      botId: bot.id,
      botName: bot.name,
      level: 'INFO',
      event: 'chatwoot.out_of_hours',
      message: `Mensaje fuera de horario enviado a Chatwoot (Conv #${chatwootConvId}).`
    });
    runtimeStore.persistStateToDisk();
    void syncConversationStateToDb(contact, conversation);

    if (io) {
      io.to(`org:${bot.organizationId}`).emit('log:new', logEntry);
      io.to(`org:${bot.organizationId}`).emit('conversation:updated', conversation);
    }

    return {
      accepted: true,
      action: 'out_of_hours_replied',
      conversation
    };
  }

  const matchedQuickReply = matchBotQuickReply(bot, content);

  if (matchedQuickReply) {
    const replyId = `reply-${crypto.randomUUID().slice(0, 8)}`;
    const replyIso = new Date().toISOString();
    conversation.messages.push({
      id: replyId,
      senderType: 'BOT',
      senderName: bot.name,
      content: matchedQuickReply.responseText,
      createdAt: replyIso
    });
    conversation.lastMessagePreview = matchedQuickReply.responseText;
    conversation.lastActivityAt = replyIso;
    bot.messagesToday += 2;

    await sendToChatwootWithLog({
      bot,
      config,
      apiAccessToken: secrets.apiAccessToken,
      chatwootConvId,
      content: matchedQuickReply.responseText,
      io
    });

    const logEntry = runtimeStore.appendLog({
      organizationId: bot.organizationId,
      botId: bot.id,
      botName: bot.name,
      level: 'INFO',
      event: 'chatwoot.quick_reply.sent',
      message: `Respuesta rápida "${matchedQuickReply.title}" enviada a Chatwoot (Conv #${chatwootConvId}).`
    });
    runtimeStore.persistStateToDisk();
    void syncConversationStateToDb(contact, conversation);

    if (io) {
      io.to(`org:${bot.organizationId}`).emit('log:new', logEntry);
      io.to(`org:${bot.organizationId}`).emit('conversation:updated', conversation);
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
      inputMessage: content,
      currentNodeId: conversation.currentNodeId,
      awaitingQuestionNodeId: isAwaitingInteractiveNode
        ? conversation.currentNodeId
        : null,
      variables: { ...contact.variables },
      tags: [...contact.tags]
    },
    { isLiveExecution: true, organizationId: bot.organizationId }
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

  await syncAssignedFlowLabelsToChatwoot({
    bot,
    config,
    apiAccessToken: secrets.apiAccessToken,
    userApiAccessToken: secrets.userApiAccessToken,
    chatwootConvId,
    assignedTags: simulation.assignedTags,
    io
  });

  const shouldPaceRemoteReplies = shouldCallRemoteChatwoot(
    config.baseUrl,
    chatwootConvId
  );

  for (let i = 0; i < simulation.replies.length; i += 1) {
    const reply = simulation.replies[i];
    if (i > 0 && shouldPaceRemoteReplies) {
      const previousReply = simulation.replies[i - 1];
      const waitMs = resolveInterReplyWaitMs({
        previousHadMedia: Boolean(previousReply.mediaUrl),
        nextDelayMs: reply.delayMs,
        viaChatwoot: true
      });
      await waitOutgoingPacingMs(waitMs);
    }

    const formattedText = formatBotReplyForChatwoot(reply);
    conversation.messages.push({
      id: reply.id,
      senderType: 'BOT',
      senderName: bot.name,
      content: formattedText,
      mediaUrl: reply.mediaUrl,
      mediaType: reply.mediaType,
      createdAt: new Date().toISOString()
    });
    conversation.lastMessagePreview = formattedText;

    await sendToChatwootWithLog({
      bot,
      config,
      apiAccessToken: secrets.apiAccessToken,
      chatwootConvId,
      content: formattedText,
      reply,
      io
    });
  }

  if (simulation.handoffRequested) {
    conversation.status = 'PENDING_AGENT';
    conversation.handoffReason = simulation.handoffSummary;

    if (simulation.handoffSummary) {
      await sendToChatwootWithLog({
        bot,
        config,
        apiAccessToken: secrets.apiAccessToken,
        chatwootConvId,
        content: simulation.handoffSummary,
        isPrivate: true,
        io
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

  runtimeStore.persistStateToDisk();
  void syncConversationStateToDb(contact, conversation);

  const logEntry = runtimeStore.appendLog({
    organizationId: bot.organizationId,
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
    io.to(`org:${bot.organizationId}`).emit('log:new', logEntry);
    io.to(`org:${bot.organizationId}`).emit('conversation:updated', conversation);
  }

  return {
    accepted: true,
    action: 'bot_flow_replied',
    conversation
  };
}
