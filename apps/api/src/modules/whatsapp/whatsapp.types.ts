import { BotConnectionStatus, WhatsAppDriverType } from '@bothub/shared';

export interface WhatsAppSessionRuntimeState {
  botId: string;
  organizationId: string;
  driver: WhatsAppDriverType;
  status: BotConnectionStatus;
  phoneNumber: string | null;
  qrDataUrl: string | null;
  rawQr: string | null;
  qrGeneratedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface OutboundWhatsAppMessage {
  toPhoneNumber: string;
  text: string;
}

export interface WhatsAppProviderDriver {
  readonly driverType: WhatsAppDriverType;
  connectSession(botId: string, organizationId: string): Promise<WhatsAppSessionRuntimeState>;
  disconnectSession(botId: string, organizationId: string): Promise<WhatsAppSessionRuntimeState>;
  resetSession(botId: string, organizationId: string): Promise<WhatsAppSessionRuntimeState>;
  simulatePairSuccess(
    botId: string,
    organizationId: string,
    phoneNumber?: string
  ): Promise<WhatsAppSessionRuntimeState>;
  getSessionState(botId: string, organizationId: string): Promise<WhatsAppSessionRuntimeState>;
  sendTextMessage(botId: string, payload: OutboundWhatsAppMessage): Promise<{ externalMessageId: string }>;
}
