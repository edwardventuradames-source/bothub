import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import { BotConnectionStatus, BotDto } from '@bothub/shared';
import {
  encryptSecret,
  generateRandomOpaqueToken,
  verifySecretConstantTime
} from '../../lib/crypto.js';
import { runtimeStore } from '../../lib/runtime-store.js';
import { executeFlowSimulationStep } from '../flows/flow.engine.js';

const QR_TTL_MILLISECONDS = 60 * 1000;

export interface WhatsAppSessionAuthBundle {
  botId: string;
  encryptedCredsPayload: string;
  updatedAt: string;
}

const encryptedBaileysSessions = new Map<string, WhatsAppSessionAuthBundle>();

function broadcastBotStatus(
  io: SocketIOServer | undefined,
  bot: BotDto
): void {
  if (!io) {
    return;
  }
  io.emit('whatsapp:status', {
    botId: bot.id,
    status: bot.status,
    qrCodeData: bot.qrCodeData,
    qrExpiresAt: bot.qrExpiresAt,
    lastConnectedAt: bot.lastConnectedAt
  });
  if (bot.qrCodeData) {
    io.emit('whatsapp:qr', {
      botId: bot.id,
      qrCodeData: bot.qrCodeData,
      qrExpiresAt: bot.qrExpiresAt
    });
  }
}

export class BaileysDriver {
  public static requestNewQrCode(botId: string, io?: SocketIOServer): BotDto {
    const bot = runtimeStore.bots.find((item) => item.id === botId);
    if (!bot) {
      throw new Error('Bot no encontrado');
    }

    const nonce = generateRandomOpaqueToken(12);
    const qrPayload = `BOTHUB-WA-MD://2@${bot.id}:${nonce}:${Date.now()}`;
    const expiresAt = new Date(Date.now() + QR_TTL_MILLISECONDS).toISOString();

    bot.status = 'WAITING_QR';
    bot.qrCodeData = qrPayload;
    bot.qrExpiresAt = expiresAt;
    bot.updatedAt = new Date().toISOString();

    runtimeStore.appendLog({
      botId: bot.id,
      botName: bot.name,
      level: 'INFO',
      event: 'whatsapp.baileys.qr_ready',
      message: `Nuevo código QR generado para ${bot.name}. Expira en 60 segundos.`,
      metadata: { expiresAt }
    });

    broadcastBotStatus(io, bot);
    return bot;
  }

  public static completeQrPairing(botId: string, io?: SocketIOServer): BotDto {
    const bot = runtimeStore.bots.find((item) => item.id === botId);
    if (!bot) {
      throw new Error('Bot no encontrado');
    }

    const sessionMaterial = JSON.stringify({
      noiseKey: generateRandomOpaqueToken(32),
      signedIdentityKey: generateRandomOpaqueToken(32),
      registrationId: crypto.randomInt(10000, 99999),
      pairedAt: new Date().toISOString()
    });

    encryptedBaileysSessions.set(bot.id, {
      botId: bot.id,
      encryptedCredsPayload: encryptSecret(sessionMaterial),
      updatedAt: new Date().toISOString()
    });

    const nowIso = new Date().toISOString();
    bot.status = 'CONNECTED';
    bot.isActive = true;
    bot.qrCodeData = null;
    bot.qrExpiresAt = null;
    bot.lastConnectedAt = nowIso;
    bot.updatedAt = nowIso;

    runtimeStore.appendLog({
      botId: bot.id,
      botName: bot.name,
      level: 'INFO',
      event: 'whatsapp.baileys.connected',
      message: `Sesión Baileys vinculada y cifrada con AES-256-GCM para ${bot.name}.`,
      metadata: { phoneNumber: bot.phoneNumber }
    });

    broadcastBotStatus(io, bot);
    return bot;
  }

  public static setBotConnectionStatus(
    botId: string,
    status: BotConnectionStatus,
    io?: SocketIOServer
  ): BotDto {
    const bot = runtimeStore.bots.find((item) => item.id === botId);
    if (!bot) {
      throw new Error('Bot no encontrado');
    }

    bot.status = status;
    bot.isActive = status === 'CONNECTED' || status === 'WAITING_QR';
    if (status !== 'WAITING_QR') {
      bot.qrCodeData = null;
      bot.qrExpiresAt = null;
    }
    if (status === 'CONNECTED') {
      bot.lastConnectedAt = new Date().toISOString();
    }
    bot.updatedAt = new Date().toISOString();

    runtimeStore.appendLog({
      botId: bot.id,
      botName: bot.name,
      level: status === 'ERROR' || status === 'DISCONNECTED' ? 'WARN' : 'INFO',
      event: `whatsapp.status.${status.toLowerCase()}`,
      message: `Estado del bot ${bot.name} actualizado a ${status}.`
    });

    broadcastBotStatus(io, bot);
    return bot;
  }
}

export class CloudApiDriver {
  public static configureOfficialCloudApi(
    botId: string,
    input: {
      phoneNumberId: string;
      wabaId: string;
      accessToken: string;
      verifyToken: string;
    }
  ): BotDto {
    const bot = runtimeStore.bots.find((item) => item.id === botId);
    if (!bot) {
      throw new Error('Bot no encontrado');
    }

    runtimeStore.saveCloudApiConfigForBot(botId, input);
    bot.driver = 'CLOUD_API';
    bot.status = 'CONNECTED';
    bot.isActive = true;
    bot.qrCodeData = null;
    bot.qrExpiresAt = null;
    bot.lastConnectedAt = new Date().toISOString();
    bot.updatedAt = new Date().toISOString();

    runtimeStore.appendLog({
      botId: bot.id,
      botName: bot.name,
      level: 'INFO',
      event: 'whatsapp.cloud_api.configured',
      message: `Driver WhatsApp Cloud API configurado y cifrado con AES-256-GCM para ${bot.name}.`
    });

    return bot;
  }

  public static verifyWebhookSubscription(
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

  public static handleIncomingWhatsAppMessage(
    botId: string,
    input: {
      fromPhone: string;
      contactName: string;
      text: string;
    },
    io?: SocketIOServer
  ) {
    const bot = runtimeStore.bots.find((item) => item.id === botId) ?? runtimeStore.bots[0];
    const flow =
      runtimeStore.flows.find((item) => item.id === bot.activeFlowId) ??
      runtimeStore.flows[0];

    let contact = runtimeStore.contacts.find(
      (item) => item.phoneNumber === input.fromPhone
    );
    if (!contact) {
      contact = {
        id: `contact-${crypto.randomUUID().slice(0, 8)}`,
        organizationId: bot.organizationId,
        name: input.contactName || 'Contacto WhatsApp',
        phoneNumber: input.fromPhone,
        email: null,
        nationalId: null,
        chatwootContactId: crypto.randomInt(5000, 9999),
        tags: ['whatsapp-inbound'],
        variables: {
          nombre: input.contactName || 'Contacto WhatsApp',
          telefono: input.fromPhone
        },
        conversationsCount: 1,
        lastInteractionAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      runtimeStore.contacts.unshift(contact);
    }

    const simulation = executeFlowSimulationStep(
      flow.draftVersion.nodes,
      flow.draftVersion.edges,
      {
        inputMessage: input.text,
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
    bot.messagesToday += 1 + simulation.replies.length;

    const nowIso = new Date().toISOString();
    let conversation = runtimeStore.conversations.find(
      (item) => item.contactId === contact.id && item.botId === bot.id
    );

    if (!conversation) {
      conversation = {
        id: `conv-${crypto.randomUUID().slice(0, 8)}`,
        botId: bot.id,
        botName: bot.name,
        contactId: contact.id,
        contactName: contact.name,
        contactPhone: contact.phoneNumber,
        chatwootConversationId: crypto.randomInt(9000, 9999),
        status: simulation.handoffRequested ? 'PENDING_AGENT' : 'BOT_ACTIVE',
        assignedAgentName: null,
        currentFlowName: flow.name,
        currentNodeId: simulation.nextNodeId,
        collectedVariables: simulation.variables,
        tags: simulation.tags,
        handoffReason: simulation.handoffSummary,
        lastMessagePreview:
          simulation.replies[simulation.replies.length - 1]?.text ?? input.text,
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
      content: input.text,
      createdAt: nowIso
    });

    for (const reply of simulation.replies) {
      conversation.messages.push({
        id: reply.id,
        senderType: 'BOT',
        senderName: bot.name,
        content: reply.text,
        createdAt: new Date().toISOString()
      });
    }

    conversation.executionTrace.push(...simulation.trace);
    conversation.collectedVariables = simulation.variables;
    conversation.tags = simulation.tags;
    if (simulation.handoffRequested) {
      conversation.status = 'PENDING_AGENT';
      conversation.handoffReason = simulation.handoffSummary;
    }
    conversation.lastMessagePreview =
      simulation.replies[simulation.replies.length - 1]?.text ?? input.text;
    conversation.lastActivityAt = new Date().toISOString();

    const logEntry = runtimeStore.appendLog({
      botId: bot.id,
      botName: bot.name,
      level: 'INFO',
      event: 'whatsapp.message.processed',
      message: `Mensaje de ${contact.name} (${contact.phoneNumber}) procesado por flujo "${flow.name}".`,
      metadata: {
        repliesCount: simulation.replies.length,
        handoffRequested: simulation.handoffRequested
      }
    });

    if (io) {
      io.emit('log:new', logEntry);
      io.emit('conversation:updated', conversation);
    }

    return {
      conversation,
      simulation
    };
  }
}
