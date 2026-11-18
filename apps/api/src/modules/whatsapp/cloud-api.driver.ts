import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import { CloudApiCredentialsInput } from '@bothub/shared';
import { prisma } from '../../lib/prisma.js';
import { encryptSecret } from '../../lib/crypto.js';
import {
  OutboundWhatsAppMessage,
  WhatsAppProviderDriver,
  WhatsAppSessionRuntimeState
} from './whatsapp.types.js';

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
    this.io.to(`bot:${state.botId}`).emit('whatsapp:status', state);
    this.io.to(`org:${state.organizationId}`).emit('whatsapp:status', state);
  }

  public async saveEncryptedCredentials(
    botId: string,
    organizationId: string,
    credentials: CloudApiCredentialsInput
  ): Promise<WhatsAppSessionRuntimeState> {
    const encryptedPayload = encryptSecret(JSON.stringify(credentials));

    await prisma.bot.updateMany({
      where: { id: botId, organizationId },
      data: {
        driver: 'CLOUD_API',
        cloudApiEncryptedConfig: encryptedPayload,
        status: 'CONNECTED'
      }
    });

    const nextState: WhatsAppSessionRuntimeState = {
      botId,
      organizationId,
      driver: 'CLOUD_API',
      status: 'CONNECTED',
      phoneNumber: `ID: ${credentials.phoneNumberId}`,
      qrDataUrl: null,
      rawQr: null,
      qrGeneratedAt: null,
      lastError: null,
      updatedAt: new Date().toISOString()
    };

    this.states.set(botId, nextState);
    this.emitStatus(nextState);
    return nextState;
  }

  public async connectSession(
    botId: string,
    organizationId: string
  ): Promise<WhatsAppSessionRuntimeState> {
    const bot = await prisma.bot.findFirst({
      where: { id: botId, organizationId }
    });

    const hasConfig = Boolean(bot?.cloudApiEncryptedConfig);
    const status = hasConfig ? 'CONNECTED' : 'DISCONNECTED';

    if (bot) {
      await prisma.bot.update({
        where: { id: bot.id },
        data: { status }
      });
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
    await prisma.bot.updateMany({
      where: { id: botId, organizationId },
      data: { status: 'DISCONNECTED' }
    });

    const state: WhatsAppSessionRuntimeState = {
      botId,
      organizationId,
      driver: 'CLOUD_API',
      status: 'DISCONNECTED',
      phoneNumber: null,
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
    phoneNumber = '+58 412-5550199'
  ): Promise<WhatsAppSessionRuntimeState> {
    const state: WhatsAppSessionRuntimeState = {
      botId,
      organizationId,
      driver: 'CLOUD_API',
      status: 'CONNECTED',
      phoneNumber,
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

  public async getSessionState(
    botId: string,
    organizationId: string
  ): Promise<WhatsAppSessionRuntimeState> {
    const cached = this.states.get(botId);
    if (cached) {
      return cached;
    }
    return {
      botId,
      organizationId,
      driver: 'CLOUD_API',
      status: 'DISCONNECTED',
      phoneNumber: null,
      qrDataUrl: null,
      rawQr: null,
      qrGeneratedAt: null,
      lastError: null,
      updatedAt: new Date().toISOString()
    };
  }

  public async sendTextMessage(
    _botId: string,
    _payload: OutboundWhatsAppMessage
  ): Promise<{ externalMessageId: string }> {
    return {
      externalMessageId: `wamid.${crypto.randomUUID()}`
    };
  }
}
