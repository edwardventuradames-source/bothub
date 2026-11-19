import crypto from 'node:crypto';
import makeWASocket, {
  DisconnectReason,
  proto,
  WASocket
} from 'baileys';
import QRCode from 'qrcode';
import { Server as SocketIOServer } from 'socket.io';
import { BotConnectionStatus, FlowSimulationBotReply } from '@bothub/shared';
import { runtimeStore } from '../../lib/runtime-store.js';
import { syncBotRecordToDb } from '../../lib/persistence.js';
import { logger } from '../../lib/logger.js';
import { formatBotReplyForChatwoot } from '../chatwoot/chatwoot.client.js';
import {
  clearAllEncryptedBotSessions,
  hasPersistedBotSession,
  usePrismaEncryptedAuthState
} from './baileys.auth-state.js';
import { processInboundWhatsAppMessage } from './inbound-pipeline.js';
import {
  OutboundWhatsAppMessage,
  WhatsAppProviderDriver,
  WhatsAppSessionRuntimeState
} from './whatsapp.types.js';

const QR_EXPIRATION_SECONDS = 60;
const BASE_RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

interface ActiveBaileysSession {
  socket: WASocket | null;
  state: WhatsAppSessionRuntimeState;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
  manualStop: boolean;
}

function extractIncomingTextFromMessage(message: proto.IMessage): string {
  if (message.conversation) {
    return message.conversation;
  }
  if (message.extendedTextMessage?.text) {
    return message.extendedTextMessage.text;
  }
  if (message.buttonsResponseMessage) {
    return (
      message.buttonsResponseMessage.selectedButtonId ||
      message.buttonsResponseMessage.selectedDisplayText ||
      ''
    );
  }
  if (message.listResponseMessage) {
    return (
      message.listResponseMessage.singleSelectReply?.selectedRowId ||
      message.listResponseMessage.title ||
      ''
    );
  }
  if (message.templateButtonReplyMessage) {
    return (
      message.templateButtonReplyMessage.selectedId ||
      message.templateButtonReplyMessage.selectedDisplayText ||
      ''
    );
  }
  if (message.imageMessage?.caption) {
    return message.imageMessage.caption;
  }
  if (message.videoMessage?.caption) {
    return message.videoMessage.caption;
  }
  if (message.documentMessage?.caption) {
    return message.documentMessage.caption;
  }
  return '';
}

function formatPhoneFromJid(jid: string): string {
  const userPart = jid.split('@')[0]?.split(':')[0] ?? '';
  const digits = userPart.replace(/[^\d]/g, '');
  return digits ? `+${digits}` : userPart;
}

export class BaileysDriver implements WhatsAppProviderDriver {
  public readonly driverType = 'BAILEYS' as const;
  private readonly sessions = new Map<string, ActiveBaileysSession>();
  private io: SocketIOServer | null = null;

  public bindSocketServer(io: SocketIOServer): void {
    this.io = io;
  }

  private emitRealtimeStatus(session: ActiveBaileysSession): void {
    if (!this.io) {
      return;
    }

    const statusEvent = {
      botId: session.state.botId,
      status: session.state.status,
      phoneNumber: session.state.phoneNumber,
      driver: this.driverType,
      qrDataUrl: session.state.qrDataUrl,
      qrCodeData: session.state.qrDataUrl,
      qrExpiresAt: session.state.qrGeneratedAt
        ? new Date(
            new Date(session.state.qrGeneratedAt).getTime() + QR_EXPIRATION_SECONDS * 1000
          ).toISOString()
        : null,
      lastError: session.state.lastError,
      updatedAt: session.state.updatedAt
    };

    this.io.to(`org:${session.state.organizationId}`).emit('whatsapp:status', statusEvent);

    if (session.state.qrDataUrl && session.state.rawQr) {
      const qrEvent = {
        botId: session.state.botId,
        qrDataUrl: session.state.qrDataUrl,
        qrCodeData: session.state.qrDataUrl,
        rawQr: session.state.rawQr,
        generatedAt: session.state.qrGeneratedAt ?? new Date().toISOString(),
        expiresInSeconds: QR_EXPIRATION_SECONDS
      };
      this.io.to(`org:${session.state.organizationId}`).emit('whatsapp:qr', qrEvent);
    }
  }

  private syncRuntimeAndDatabase(
    botId: string,
    status: BotConnectionStatus,
    patch: {
      phoneNumber?: string | null;
      qrCodeData?: string | null;
      qrExpiresAt?: string | null;
      lastConnectedAt?: string | null;
      isActive?: boolean;
    } = {},
    logEvent?: { level: 'INFO' | 'WARN' | 'ERROR'; event: string; message: string }
  ): void {
    const bot = runtimeStore.bots.find((item) => item.id === botId);
    if (bot) {
      bot.status = status;
      if (patch.phoneNumber !== undefined && patch.phoneNumber !== null) {
        bot.phoneNumber = patch.phoneNumber;
      }
      if (patch.qrCodeData !== undefined) {
        bot.qrCodeData = patch.qrCodeData;
      }
      if (patch.qrExpiresAt !== undefined) {
        bot.qrExpiresAt = patch.qrExpiresAt;
      }
      if (patch.lastConnectedAt !== undefined) {
        bot.lastConnectedAt = patch.lastConnectedAt;
      }
      if (patch.isActive !== undefined) {
        bot.isActive = patch.isActive;
      }
      bot.updatedAt = new Date().toISOString();
      runtimeStore.persistStateToDisk();
      void syncBotRecordToDb(bot);
    }

    if (logEvent) {
      const logEntry = runtimeStore.appendLog({
        botId,
        botName: bot?.name,
        level: logEvent.level,
        event: logEvent.event,
        message: logEvent.message
      });
      if (this.io && bot) {
        this.io.to(`org:${bot.organizationId}`).emit('log:new', logEntry);
      }
    }
  }

  private getOrCreateSessionEntry(
    botId: string,
    organizationId: string
  ): ActiveBaileysSession {
    const existing = this.sessions.get(botId);
    if (existing) {
      return existing;
    }

    const bot = runtimeStore.bots.find((item) => item.id === botId);
    const created: ActiveBaileysSession = {
      socket: null,
      reconnectAttempts: 0,
      reconnectTimer: null,
      manualStop: false,
      state: {
        botId,
        organizationId,
        driver: 'BAILEYS',
        status: bot?.status ?? 'DISCONNECTED',
        phoneNumber: bot?.phoneNumber ?? null,
        qrDataUrl: null,
        rawQr: null,
        qrGeneratedAt: null,
        lastError: null,
        updatedAt: new Date().toISOString()
      }
    };
    this.sessions.set(botId, created);
    return created;
  }

  private clearTimers(entry: ActiveBaileysSession): void {
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
  }

  private closeSocketSafely(entry: ActiveBaileysSession): void {
    if (entry.socket) {
      try {
        entry.socket.end(undefined);
      } catch {
        void 0;
      }
      entry.socket = null;
    }
  }

  private async assignQrToSession(
    entry: ActiveBaileysSession,
    rawQrPayload: string
  ): Promise<void> {
    const qrDataUrl = await QRCode.toDataURL(rawQrPayload, {
      width: 280,
      margin: 2,
      color: {
        dark: '#141727',
        light: '#FFFFFF'
      }
    });

    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + QR_EXPIRATION_SECONDS * 1000).toISOString();
    entry.state = {
      ...entry.state,
      status: 'WAITING_QR',
      qrDataUrl,
      rawQr: rawQrPayload,
      qrGeneratedAt: nowIso,
      lastError: null,
      updatedAt: nowIso
    };

    this.syncRuntimeAndDatabase(
      entry.state.botId,
      'WAITING_QR',
      { qrCodeData: qrDataUrl, qrExpiresAt: expiresAt, isActive: true },
      {
        level: 'INFO',
        event: 'whatsapp.baileys.qr_ready',
        message: 'Código QR real de WhatsApp generado y esperando escaneo.'
      }
    );
    this.emitRealtimeStatus(entry);
  }

  private async sendReplyViaSocket(
    sock: WASocket,
    targetJid: string,
    reply: FlowSimulationBotReply
  ): Promise<void> {
    const formattedText = formatBotReplyForChatwoot(reply);

    if (reply.mediaUrl) {
      const cleanPath = reply.mediaUrl.split('?')[0].toLowerCase();
      if (/\.(mp3|ogg|wav|m4a|opus)$/.test(cleanPath) || reply.mediaType === 'audio') {
        await sock.sendMessage(targetJid, {
          audio: { url: reply.mediaUrl },
          mimetype: cleanPath.endsWith('.ogg') || cleanPath.endsWith('.opus')
            ? 'audio/ogg; codecs=opus'
            : 'audio/mpeg'
        });
        if (formattedText) {
          await sock.sendMessage(targetJid, { text: formattedText });
        }
        return;
      }
      if (/\.(mp4|mov|webm)$/.test(cleanPath)) {
        await sock.sendMessage(targetJid, {
          video: { url: reply.mediaUrl },
          caption: formattedText || undefined
        });
        return;
      }
      if (
        /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|txt|zip)$/.test(cleanPath) ||
        reply.mediaType === 'document'
      ) {
        const rawFileName = cleanPath.split('/').pop() || 'archivo';
        const mimetype = cleanPath.endsWith('.pdf')
          ? 'application/pdf'
          : 'application/octet-stream';
        await sock.sendMessage(targetJid, {
          document: { url: reply.mediaUrl },
          mimetype,
          fileName: rawFileName,
          caption: formattedText || undefined
        });
        return;
      }
      await sock.sendMessage(targetJid, {
        image: { url: reply.mediaUrl },
        caption: formattedText || undefined
      });
      return;
    }

    await sock.sendMessage(targetJid, { text: formattedText });
  }

  public async connectSession(
    botId: string,
    organizationId: string
  ): Promise<WhatsAppSessionRuntimeState> {
    const entry = this.getOrCreateSessionEntry(botId, organizationId);
    this.clearTimers(entry);
    this.closeSocketSafely(entry);
    entry.manualStop = false;

    entry.state = {
      ...entry.state,
      status: 'RECONNECTING',
      qrDataUrl: null,
      rawQr: null,
      lastError: null,
      updatedAt: new Date().toISOString()
    };
    this.syncRuntimeAndDatabase(botId, 'RECONNECTING', {
      qrCodeData: null,
      qrExpiresAt: null
    });
    this.emitRealtimeStatus(entry);

    try {
      const { state: authState, saveCreds } = await usePrismaEncryptedAuthState(botId);

      const sock = makeWASocket({
        auth: authState,
        printQRInTerminal: false,
        browser: ['BotHub Enterprise', 'Chrome', '1.0.0'],
        connectTimeoutMs: 20000
      });

      entry.socket = sock;
      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !entry.manualStop) {
          await this.assignQrToSession(entry, qr);
        }

        if (connection === 'open') {
          this.clearTimers(entry);
          entry.reconnectAttempts = 0;
          const jidUser = sock.user?.id ?? '';
          const resolvedPhone = jidUser
            ? formatPhoneFromJid(jidUser)
            : entry.state.phoneNumber;
          const nowIso = new Date().toISOString();

          entry.state = {
            ...entry.state,
            status: 'CONNECTED',
            phoneNumber: resolvedPhone,
            qrDataUrl: null,
            rawQr: null,
            lastError: null,
            updatedAt: nowIso
          };

          this.syncRuntimeAndDatabase(
            botId,
            'CONNECTED',
            {
              phoneNumber: resolvedPhone,
              qrCodeData: null,
              qrExpiresAt: null,
              lastConnectedAt: nowIso,
              isActive: true
            },
            {
              level: 'INFO',
              event: 'whatsapp.baileys.connected',
              message: `Sesión Baileys vinculada exitosamente (${resolvedPhone ?? 'número activo'}).`
            }
          );
          this.emitRealtimeStatus(entry);
        }

        if (connection === 'close' && !entry.manualStop) {
          const statusCode = (
            lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
          )?.output?.statusCode;

          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          if (isLoggedOut) {
            await clearAllEncryptedBotSessions(botId);
            entry.state = {
              ...entry.state,
              status: 'DISCONNECTED',
              qrDataUrl: null,
              rawQr: null,
              lastError: 'Sesión cerrada desde el dispositivo móvil.',
              updatedAt: new Date().toISOString()
            };
            this.syncRuntimeAndDatabase(
              botId,
              'DISCONNECTED',
              { qrCodeData: null, qrExpiresAt: null },
              {
                level: 'WARN',
                event: 'whatsapp.baileys.logged_out',
                message: 'Sesión Baileys cerrada desde el dispositivo móvil.'
              }
            );
            this.emitRealtimeStatus(entry);
            return;
          }

          if (entry.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            entry.reconnectAttempts += 1;
            const delayMs = BASE_RECONNECT_DELAY_MS * entry.reconnectAttempts;
            entry.state = {
              ...entry.state,
              status: 'RECONNECTING',
              lastError: `Reconectando (intento ${entry.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`,
              updatedAt: new Date().toISOString()
            };
            this.syncRuntimeAndDatabase(botId, 'RECONNECTING');
            this.emitRealtimeStatus(entry);
            entry.reconnectTimer = setTimeout(() => {
              void this.connectSession(botId, organizationId);
            }, delayMs);
            return;
          }

          entry.state = {
            ...entry.state,
            status: 'ERROR',
            qrDataUrl: null,
            rawQr: null,
            lastError: 'Se agotaron los reintentos de conexión con WhatsApp.',
            updatedAt: new Date().toISOString()
          };
          this.syncRuntimeAndDatabase(
            botId,
            'ERROR',
            { qrCodeData: null, qrExpiresAt: null },
            {
              level: 'ERROR',
              event: 'whatsapp.baileys.connection_failed',
              message: 'No fue posible establecer conexión con WhatsApp tras varios reintentos.'
            }
          );
          this.emitRealtimeStatus(entry);
        }
      });

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;
          const remoteJid = msg.key.remoteJid ?? '';
          if (
            !remoteJid ||
            remoteJid.endsWith('@g.us') ||
            remoteJid === 'status@broadcast'
          ) {
            continue;
          }

          const text = extractIncomingTextFromMessage(msg.message).trim();
          if (!text) continue;

          const fromPhone = formatPhoneFromJid(remoteJid);
          const contactName = msg.pushName?.trim() || fromPhone;

          try {
            await processInboundWhatsAppMessage({
              botId,
              fromPhone,
              contactName,
              text,
              externalMessageId: msg.key.id ?? undefined,
              io: this.io ?? undefined,
              onTyping: async () => {
                await sock.sendPresenceUpdate('composing', remoteJid).catch(() => undefined);
              },
              sendReply: async (reply) => {
                await this.sendReplyViaSocket(sock, remoteJid, reply);
              }
            });
          } catch (err) {
            logger.error(
              { botId, remoteJid, err },
              'Error processing inbound Baileys message'
            );
          }
        }
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error inicializando Baileys';
      logger.error({ botId, err: error }, 'Baileys socket initialization failed');
      entry.state = {
        ...entry.state,
        status: 'ERROR',
        qrDataUrl: null,
        rawQr: null,
        lastError: errorMessage,
        updatedAt: new Date().toISOString()
      };
      this.syncRuntimeAndDatabase(
        botId,
        'ERROR',
        { qrCodeData: null, qrExpiresAt: null },
        {
          level: 'ERROR',
          event: 'whatsapp.baileys.init_error',
          message: `Error iniciando Baileys: ${errorMessage}`
        }
      );
      this.emitRealtimeStatus(entry);
    }

    return entry.state;
  }

  public async restorePersistedSessions(): Promise<void> {
    for (const bot of runtimeStore.bots) {
      if (bot.driver === 'BAILEYS' && bot.isActive && bot.status !== 'PAUSED') {
        const hasSession = await hasPersistedBotSession(bot.id);
        if (hasSession) {
          void this.connectSession(bot.id, bot.organizationId);
        }
      }
    }
  }

  public async simulatePairSuccess(
    botId: string,
    organizationId: string,
    _phoneNumber?: string
  ): Promise<WhatsAppSessionRuntimeState> {
    return this.getSessionState(botId, organizationId);
  }

  public async disconnectSession(
    botId: string,
    organizationId: string
  ): Promise<WhatsAppSessionRuntimeState> {
    const entry = this.getOrCreateSessionEntry(botId, organizationId);
    entry.manualStop = true;
    this.clearTimers(entry);
    this.closeSocketSafely(entry);

    entry.state = {
      ...entry.state,
      status: 'DISCONNECTED',
      qrDataUrl: null,
      rawQr: null,
      lastError: null,
      updatedAt: new Date().toISOString()
    };

    this.syncRuntimeAndDatabase(
      botId,
      'DISCONNECTED',
      { qrCodeData: null, qrExpiresAt: null, isActive: false },
      {
        level: 'INFO',
        event: 'whatsapp.baileys.disconnected',
        message: 'Sesión Baileys desconectada manualmente.'
      }
    );
    this.emitRealtimeStatus(entry);

    return entry.state;
  }

  public async resetSession(
    botId: string,
    organizationId: string
  ): Promise<WhatsAppSessionRuntimeState> {
    await this.disconnectSession(botId, organizationId);
    await clearAllEncryptedBotSessions(botId);
    return this.connectSession(botId, organizationId);
  }

  public async getSessionState(
    botId: string,
    organizationId: string
  ): Promise<WhatsAppSessionRuntimeState> {
    const existing = this.sessions.get(botId);
    if (existing) {
      return existing.state;
    }

    const bot = runtimeStore.bots.find(
      (item) => item.id === botId && item.organizationId === organizationId
    );
    const entry = this.getOrCreateSessionEntry(botId, organizationId);
    if (bot) {
      entry.state = {
        ...entry.state,
        status: bot.status,
        phoneNumber: bot.phoneNumber,
        qrDataUrl: bot.qrCodeData,
        updatedAt: bot.updatedAt
      };
    }
    return entry.state;
  }

  public async sendTextMessage(
    botId: string,
    payload: OutboundWhatsAppMessage
  ): Promise<{ externalMessageId: string }> {
    const entry = this.sessions.get(botId);
    const normalizedDigits = payload.toPhoneNumber.replace(/[^\d]/g, '');
    const targetJid = `${normalizedDigits}@s.whatsapp.net`;

    if (!entry?.socket || entry.state.status !== 'CONNECTED') {
      throw new Error(`La sesión Baileys del bot "${botId}" no está conectada.`);
    }

    const sent = await entry.socket.sendMessage(targetJid, {
      text: payload.text
    });
    return {
      externalMessageId: sent?.key?.id ?? `baileys-${crypto.randomUUID()}`
    };
  }
}
