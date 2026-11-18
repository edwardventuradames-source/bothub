import { Server as SocketIOServer } from 'socket.io';
import { CloudApiCredentialsInput, WhatsAppDriverType } from '@bothub/shared';
import { BaileysDriver } from './baileys.driver.js';
import { CloudApiDriver } from './cloud-api.driver.js';
import {
  OutboundWhatsAppMessage,
  WhatsAppProviderDriver,
  WhatsAppSessionRuntimeState
} from './whatsapp.types.js';

export class WhatsAppProvider {
  private readonly baileysDriver = new BaileysDriver();
  private readonly cloudApiDriver = new CloudApiDriver();

  public bindSocketServer(io: SocketIOServer): void {
    this.baileysDriver.bindSocketServer(io);
    this.cloudApiDriver.bindSocketServer(io);
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

  public async simulateQrPairing(
    botId: string,
    organizationId: string,
    driverType: WhatsAppDriverType,
    phoneNumber?: string
  ): Promise<WhatsAppSessionRuntimeState> {
    return this.resolveDriver(driverType).simulatePairSuccess(
      botId,
      organizationId,
      phoneNumber
    );
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

  public async sendMessage(
    botId: string,
    driverType: WhatsAppDriverType,
    payload: OutboundWhatsAppMessage
  ): Promise<{ externalMessageId: string }> {
    return this.resolveDriver(driverType).sendTextMessage(botId, payload);
  }
}

export const whatsappProvider = new WhatsAppProvider();
