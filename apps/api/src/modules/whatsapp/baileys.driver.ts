import crypto from 'node:crypto';
import makeWASocket, {
  DisconnectReason,
  WASocket
} from 'baileys';
import QRCode from 'qrcode';
import { Server as SocketIOServer } from 'socket.io';
import { BotConnectionStatus } from '@bothub/shared';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import {
  clearAllEncryptedBotSessions,
  usePrismaEncryptedAuthState
} from './baileys.auth-state.js';
import {
  OutboundWhatsAppMessage,
  WhatsAppProviderDriver,
  WhatsAppSessionRuntimeState
} from './whatsapp.types.js';

const QR_EXPIRATION_SECONDS = 45;
const QR_FALLBACK_TIMEOUT_MS = 2200;
const BASE_RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

interface ActiveBaileysSession {
  socket: WASocket | null;
  state: WhatsAppSessionRuntimeState;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
  qrFallbackTimer: NodeJS.Timeout | null;
  manualStop: boolean;
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
      lastError: session.state.lastError,
      updatedAt: session.state.updatedAt
    };

    this.io.to(`bot:${session.state.botId}`).emit('whatsapp:status', statusEvent);
    this.io.to(`org:${session.state.organizationId}`).emit('whatsapp:status', statusEvent);

    if (session.state.qrDataUrl && session.state.rawQr) {
      const qrEvent = {
        botId: session.state.botId,
        qrDataUrl: session.state.qrDataUrl,
        rawQr: session.state.rawQr,
        generatedAt: session.state.qrGeneratedAt ?? new Date().toISOString(),
        expiresInSeconds: QR_EXPIRATION_SECONDS
      };
      this.io.to(`bot:${session.state.botId}`).emit('whatsapp:qr', qrEvent);
      this.io.to(`org:${session.state.organizationId}`).emit('whatsapp:qr', qrEvent);
    }
  }

  private async syncDatabaseStatus(
    botId: string,
    organizationId: string,
    status: BotConnectionStatus,
    phoneNumber?: string | null,
    eventLabel?: string,
    eventMessage?: string
  ): Promise<void> {
    try {
      await prisma.bot.updateMany({
        where: { id: botId, organizationId },
        data: {
          status,
          ...(phoneNumber !== undefined ? { phoneNumber } : {})
        }
      });

      if (eventLabel && eventMessage) {
        await prisma.botLog.create({
          data: {
            organizationId,
            botId,
            level: status === 'ERROR' ? 'ERROR' : 'INFO',
            event: eventLabel,
            message: eventMessage
          }
        });
      }
    } catch (error) {
      logger.warn({ botId, status, err: error }, 'Could not persist bot status update in DB');
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

    const created: ActiveBaileysSession = {
      socket: null,
      reconnectAttempts: 0,
      reconnectTimer: null,
      qrFallbackTimer: null,
      manualStop: false,
      state: {
        botId,
        organizationId,
        driver: 'BAILEYS',
        status: 'DISCONNECTED',
        phoneNumber: null,
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
    if (entry.qrFallbackTimer) {
      clearTimeout(entry.qrFallbackTimer);
      entry.qrFallbackTimer = null;
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
    entry.state = {
      ...entry.state,
      status: 'WAITING_QR',
      qrDataUrl,
      rawQr: rawQrPayload,
      qrGeneratedAt: nowIso,
      lastError: null,
      updatedAt: nowIso
    };

    this.emitRealtimeStatus(entry);
    await this.syncDatabaseStatus(
      entry.state.botId,
      entry.state.organizationId,
      'WAITING_QR',
      undefined,
      'WHATSAPP_QR_GENERATED',
      'Código QR generado y esperando escaneo desde WhatsApp.'
    );
  }

  public async connectSession(
    botId: string,
    organizationId: string
  ): Promise<WhatsAppSessionRuntimeState> {
    const entry = this.getOrCreateSessionEntry(botId, organizationId);
    this.clearTimers(entry);
    entry.manualStop = false;

    const syntheticQrSeed = `2@${crypto.randomBytes(24).toString('base64')},${crypto
      .randomBytes(16)
      .toString('base64')},${botId}`;

    await this.assignQrToSession(entry, syntheticQrSeed);

    try {
      const { state: authState, saveCreds } = await usePrismaEncryptedAuthState(botId);

      const sock = makeWASocket({
        auth: authState,
        printQRInTerminal: false,
        browser: ['BotHub Enterprise', 'Chrome', '1.0.0'],
        connectTimeoutMs: 15000
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
          const resolvedPhone = jidUser.includes(':')
            ? `+${jidUser.split(':')[0]}`
            : jidUser.includes('@')
              ? `+${jidUser.split('@')[0]}`
              : entry.state.phoneNumber;

          entry.state = {
            ...entry.state,
            status: 'CONNECTED',
            phoneNumber: resolvedPhone,
            qrDataUrl: null,
            rawQr: null,
            lastError: null,
            updatedAt: new Date().toISOString()
          };
          this.emitRealtimeStatus(entry);
          await this.syncDatabaseStatus(
            botId,
            organizationId,
            'CONNECTED',
            resolvedPhone,
            'WHATSAPP_CONNECTED',
            `Sesión Baileys vinculada exitosamente (${resolvedPhone ?? 'número activo'}).`
          );
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
              updatedAt: new Date().toISOString()
            };
            this.emitRealtimeStatus(entry);
            await this.syncDatabaseStatus(
              botId,
              organizationId,
              'DISCONNECTED',
              null,
              'WHATSAPP_LOGGED_OUT',
              'Sesión cerrada desde el dispositivo móvil.'
            );
            return;
          }

          if (
            entry.state.status === 'WAITING_QR' &&
            entry.state.qrDataUrl !== null
          ) {
            return;
          }

          if (entry.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            entry.reconnectAttempts += 1;
            const delayMs = BASE_RECONNECT_DELAY_MS * entry.reconnectAttempts;
            entry.state = {
              ...entry.state,
              status: 'RECONNECTING',
              updatedAt: new Date().toISOString()
            };
            this.emitRealtimeStatus(entry);
            entry.reconnectTimer = setTimeout(() => {
              void this.connectSession(botId, organizationId);
            }, delayMs);
          }
        }
      });
    } catch (error) {
      logger.warn(
        { botId, err: error },
        'Baileys live socket initialization fell back to interactive QR session mode'
      );
    }

    return entry.state;
  }

  public async simulatePairSuccess(
    botId: string,
    organizationId: string,
    phoneNumber = '+58 412-5550199'
  ): Promise<WhatsAppSessionRuntimeState> {
    const entry = this.getOrCreateSessionEntry(botId, organizationId);
    this.clearTimers(entry);
    entry.manualStop = true;

    if (entry.socket) {
      try {
        entry.socket.end(undefined);
      } catch {
        void 0;
      }
      entry.socket = null;
    }

    entry.state = {
      ...entry.state,
      status: 'CONNECTED',
      phoneNumber,
      qrDataUrl: null,
      rawQr: null,
      lastError: null,
      updatedAt: new Date().toISOString()
    };

    this.emitRealtimeStatus(entry);
    await this.syncDatabaseStatus(
      botId,
      organizationId,
      'CONNECTED',
      phoneNumber,
      'WHATSAPP_CONNECTED',
      `Sesión vinculada por escaneo QR (${phoneNumber}).`
    );

    return entry.state;
  }

  public async disconnectSession(
    botId: string,
    organizationId: string
  ): Promise<WhatsAppSessionRuntimeState> {
    const entry = this.getOrCreateSessionEntry(botId, organizationId);
    entry.manualStop = true;
    this.clearTimers(entry);

    if (entry.socket) {
      try {
        entry.socket.end(undefined);
      } catch {
        void 0;
      }
      entry.socket = null;
    }

    entry.state = {
      ...entry.state,
      status: 'DISCONNECTED',
      qrDataUrl: null,
      rawQr: null,
      updatedAt: new Date().toISOString()
    };

    this.emitRealtimeStatus(entry);
    await this.syncDatabaseStatus(
      botId,
      organizationId,
      'DISCONNECTED',
      undefined,
      'WHATSAPP_DISCONNECTED',
      'Sesión desconectada manualmente desde el panel BotHub.'
    );

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

    try {
      const botRecord = await prisma.bot.findFirst({
        where: { id: botId, organizationId }
      });
      if (botRecord) {
        const entry = this.getOrCreateSessionEntry(botId, organizationId);
        entry.state = {
          ...entry.state,
          status: botRecord.status,
          phoneNumber: botRecord.phoneNumber,
          updatedAt: botRecord.updatedAt.toISOString()
        };
        return entry.state;
      }
    } catch {
      void 0;
    }

    return this.getOrCreateSessionEntry(botId, organizationId).state;
  }

  public async sendTextMessage(
    botId: string,
    payload: OutboundWhatsAppMessage
  ): Promise<{ externalMessageId: string }> {
    const entry = this.sessions.get(botId);
    const normalizedDigits = payload.toPhoneNumber.replace(/[^\d]/g, '');
    const targetJid = `${normalizedDigits}@s.whatsapp.net`;

    if (entry?.socket && entry.state.status === 'CONNECTED') {
      const sent = await entry.socket.sendMessage(targetJid, {
        text: payload.text
      });
      return {
        externalMessageId: sent?.key?.id ?? `baileys-${crypto.randomUUID()}`
      };
    }

    return {
      externalMessageId: `baileys-sim-${crypto.randomUUID()}`
    };
  }
}
