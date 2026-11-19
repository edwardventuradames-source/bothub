import { Server as SocketIOServer } from 'socket.io';
import { CloudApiCredentialsInput, WhatsAppDriverType } from '@bothub/shared';
import { registerWhatsAppOutboundForwarder } from '../chatwoot/chatwoot.service.js';
import { BaileysDriver } from './baileys.driver.js';
import {
  CloudApiDriver,
  ParsedCloudWebhookMessage
} from './cloud-api.driver.js';
import {
  OutboundWhatsAppMessage,
  WhatsAppProviderDriver,
  WhatsAppSessionRuntimeState
} from './whatsapp.types.js';

export class WhatsAppProvider {
  private readonly baileysDriver = new BaileysDriver();
  private readonly cloudApiDriver = new CloudApiDriver();

  constructor() {
    registerWhatsAppOutboundForwarder(async ({ botId, toPhoneNumber, text }) => {
      const { runtimeStore } = await import('../../lib/runtime-store.js');
      const bot = runtimeStore.bots.find((item) => item.id === botId);
      if (!bot || (bot.driver !== 'BAILEYS' && bot.driver !== 'CLOUD_API')) {
        return;
      }
      await this.sendMessage(botId, bot.driver, { toPhoneNumber, text });
    });
  }

  public bindSocketServer(io: SocketIOServer): void {
    this.baileysDriver.bindSocketServer(io);
    this.cloudApiDriver.bindSocketServer(io);
  }

  public async restorePersistedSessions(): Promise<void> {
    await this.baileysDriver.restorePersistedSessions();
  }

  public resolveDriver(driverType: WhatsAppDriverType): WhatsAppProviderDriver {
    return driverType === 'CLOUD_API' ? this.cloudApiDriver : this.baileysDriver;
  }

  public async connectBot(
    botId: string,
    organizationId: string,
    driverType: WhatsAppDriverType
  ): Promise<WhatsAppSessionRuntimeState> {
    return this.resolveDriver(driverType).connectSession(botId, organizationId);
  }

  public async disconnectBot(
    botId: string,
    organizationId: string,
    driverType: WhatsAppDriverType
  ): Promise<WhatsAppSessionRuntimeState> {
    return this.resolveDriver(driverType).disconnectSession(botId, organizationId);
  }

  public async resetBotSession(
    botId: string,
    organizationId: string,
    driverType: WhatsAppDriverType
  ): Promise<WhatsAppSessionRuntimeState> {
    return this.resolveDriver(driverType).resetSession(botId, organizationId);
  }

  public async getBotSessionState(
    botId: string,
    organizationId: string,
    driverType: WhatsAppDriverType
  ): Promise<WhatsAppSessionRuntimeState> {
    return this.resolveDriver(driverType).getSessionState(botId, organizationId);
  }

  public async saveCloudApiConfig(
    botId: string,
    organizationId: string,
    credentials: CloudApiCredentialsInput
  ): Promise<WhatsAppSessionRuntimeState> {
    return this.cloudApiDriver.saveEncryptedCredentials(
      botId,
      organizationId,
      credentials
    );
  }

  public verifyCloudWebhookSubscription(
    botId: string,
    mode: string | undefined,
    verifyToken: string | undefined,
    challenge: string | undefined
  ) {
    return this.cloudApiDriver.verifyWebhookSubscription(
      botId,
      mode,
      verifyToken,
      challenge
    );
  }

  public verifyCloudWebhookSignature(
    botId: string,
    rawBody: string | Buffer,
    signatureHeader: string | undefined
  ) {
    return this.cloudApiDriver.verifyWebhookSignature(
      botId,
      rawBody,
      signatureHeader
    );
  }

  public parseCloudWebhookPayload(body: unknown) {
    return this.cloudApiDriver.parseMetaWebhookPayload(body);
  }

  public async handleCloudWebhookMessage(
    botId: string,
    input: ParsedCloudWebhookMessage,
    io?: SocketIOServer
  ) {
    return this.cloudApiDriver.handleIncomingMessage(botId, input, io);
  }

  public async sendMessage(
    botId: string,
    driverType: WhatsAppDriverType,
    payload: OutboundWhatsAppMessage
  ): Promise<{ externalMessageId: string }> {
    return this.resolveDriver(driverType).sendTextMessage(botId, payload);
  }
}

export const whatsappProvider = new WhatsAppProvider();
