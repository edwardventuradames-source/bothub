import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import {
  BotDto,
  ChatwootConfigInputSchema,
  CloudApiConfigInputSchema,
  CreateBotInputSchema,
  UpdateBotInputSchema
} from '@bothub/shared';
import {
  DEFAULT_ORG_ID,
  runtimeStore
} from '../../lib/runtime-store.js';
import { deleteBotFromDb, syncBotRecordToDb } from '../../lib/persistence.js';
import { assertSafeExternalUrl } from '../../lib/ssrf-guard.js';
import { createDefaultBusinessHours } from '../../lib/runtime-seed-graphs.js';
import { whatsappProvider } from '../whatsapp/whatsapp.provider.js';
import { ChatwootService } from '../chatwoot/chatwoot.service.js';

export async function registerBotsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Bots'],
        summary: 'Listar bots con estado en vivo'
      }
    },
    async (request) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      return {
        bots: runtimeStore.bots.filter((item) => item.organizationId === orgId)
      };
    }
  );

  app.get<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Bots'],
        summary: 'Obtener detalle de un bot por ID'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const bot = runtimeStore.bots.find(
        (item) => item.id === request.params.id && item.organizationId === orgId
      );
      if (!bot) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: 'Bot no encontrado.'
        });
      }
      return { bot };
    }
  );

  app.post(
    '/',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Bots'],
        summary: 'Crear un nuevo bot de WhatsApp'
      }
    },
    async (request, reply) => {
      const parsed = CreateBotInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Datos de creación de bot inválidos.',
          details: parsed.error.flatten()
        });
      }

      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const data = parsed.data;
      const nowIso = new Date().toISOString();
      const matchedFlow = data.activeFlowId
        ? runtimeStore.flows.find(
            (f) => f.id === data.activeFlowId && f.organizationId === orgId
          ) ?? null
        : runtimeStore.flows.find((f) => f.organizationId === orgId) ?? null;

      const newBot: BotDto = {
        id: `bot-${crypto.randomUUID().slice(0, 8)}`,
        organizationId: orgId,
        name: data.name,
        description:
          data.description ||
          (data.driver === 'CHATWOOT'
            ? 'Bot Agent de Chatwoot conectado vía Webhook y API.'
            : 'Bot de WhatsApp integrado con Chatwoot.'),
        phoneNumber:
          data.phoneNumber ||
          (data.driver === 'CHATWOOT' ? 'Chatwoot Agent Bot' : ''),
        driver: data.driver,
        status: 'DISCONNECTED',
        isActive: data.isActive,
        activeFlowId: matchedFlow?.id ?? null,
        activeFlowName: matchedFlow?.name ?? null,
        timezone: data.timezone || 'America/Bogota',
        outOfHoursMessage:
          data.outOfHoursMessage ||
          'Gracias por comunicarte. Estamos fuera de horario.',
        inactivityTimeoutMinutes: data.inactivityTimeoutMinutes,
        inactivityCloseMessage:
          data.inactivityCloseMessage || 'Sesión cerrada por inactividad.',
        typingDelayMs: data.typingDelayMs,
        rateLimitPerMinute: data.rateLimitPerMinute,
        messagesToday: 0,
        activeConversations: 0,
        handoffRate: 0,
        qrCodeData: null,
        qrExpiresAt: null,
        lastConnectedAt: null,
        chatwootConfig: null,
        cloudApiConfig: null,
        businessHours: createDefaultBusinessHours(),
        quickReplies: [],
        createdAt: nowIso,
        updatedAt: nowIso
      };

      runtimeStore.bots.unshift(newBot);
      runtimeStore.appendLog({
        botId: newBot.id,
        botName: newBot.name,
        level: 'INFO',
        event: 'bot.created',
        message: `Bot "${newBot.name}" creado con driver ${newBot.driver}.`
      });
      void syncBotRecordToDb(newBot);

      return reply.status(201).send({ bot: newBot });
    }
  );

  const updateHandler = async (
    request: { params: { id: string }; body: unknown; user?: { organizationId?: string } },
    reply: { status: (code: number) => { send: (payload: unknown) => unknown } }
  ) => {
    const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
    const bot = runtimeStore.bots.find(
      (item) => item.id === request.params.id && item.organizationId === orgId
    );
    if (!bot) {
      return reply.status(404).send({
        error: 'BOT_NOT_FOUND',
        message: 'Bot no encontrado.'
      });
    }

    const parsed = UpdateBotInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Parámetros de actualización inválidos.'
      });
    }

    const patch = parsed.data;
    if (patch.name !== undefined) bot.name = patch.name;
    if (patch.description !== undefined && patch.description !== null) {
      bot.description = patch.description;
    }
    if (patch.phoneNumber !== undefined && patch.phoneNumber !== null) {
      bot.phoneNumber = patch.phoneNumber;
    }
    if (patch.driver !== undefined) bot.driver = patch.driver;
    if (patch.isActive !== undefined) bot.isActive = patch.isActive;
    if (patch.timezone !== undefined) bot.timezone = patch.timezone;
    if (patch.outOfHoursMessage !== undefined && patch.outOfHoursMessage !== null) {
      bot.outOfHoursMessage = patch.outOfHoursMessage;
    }
    if (patch.inactivityTimeoutMinutes !== undefined) {
      bot.inactivityTimeoutMinutes = patch.inactivityTimeoutMinutes;
    }
    if (patch.inactivityCloseMessage !== undefined && patch.inactivityCloseMessage !== null) {
      bot.inactivityCloseMessage = patch.inactivityCloseMessage;
    }
    if (patch.typingDelayMs !== undefined) bot.typingDelayMs = patch.typingDelayMs;
    if (patch.rateLimitPerMinute !== undefined) {
      bot.rateLimitPerMinute = patch.rateLimitPerMinute;
    }
    if (patch.activeFlowId !== undefined) {
      const matchedFlow = patch.activeFlowId
        ? runtimeStore.flows.find(
            (f) => f.id === patch.activeFlowId && f.organizationId === orgId
          ) ?? null
        : null;
      bot.activeFlowId = matchedFlow?.id ?? null;
      bot.activeFlowName = matchedFlow?.name ?? null;
    }
    if (patch.businessHours !== undefined) {
      bot.businessHours = patch.businessHours;
    }
    if (patch.quickReplies !== undefined) {
      bot.quickReplies = patch.quickReplies.map((item, idx) => ({
        id: item.id ?? `qr-${Date.now()}-${idx}`,
        title: item.title,
        keywords: item.keywords,
        responseText: item.responseText,
        matchMode: item.matchMode,
        isActive: item.isActive
      }));
    }

    bot.updatedAt = new Date().toISOString();
    runtimeStore.persistStateToDisk();
    void syncBotRecordToDb(bot);
    return { bot };
  };

  app.put<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Bots'],
        summary: 'Actualizar configuración de un bot'
      }
    },
    updateHandler
  );

  app.patch<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Bots'],
        summary: 'Actualizar parcialmente un bot'
      }
    },
    updateHandler
  );

  app.post<{ Params: { id: string } }>(
    '/:id/duplicate',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Bots'],
        summary: 'Duplicar bot con su configuración y respuestas rápidas'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const source = runtimeStore.bots.find(
        (item) => item.id === request.params.id && item.organizationId === orgId
      );
      if (!source) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: 'Bot origen no encontrado.'
        });
      }

      const nowIso = new Date().toISOString();
      const copy: BotDto = {
        ...structuredClone(source),
        id: `bot-${crypto.randomUUID().slice(0, 8)}`,
        name: `${source.name} (Copia)`,
        status: 'DISCONNECTED',
        messagesToday: 0,
        activeConversations: 0,
        qrCodeData: null,
        qrExpiresAt: null,
        chatwootConfig: null,
        cloudApiConfig: null,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      runtimeStore.bots.unshift(copy);
      runtimeStore.appendLog({
        botId: copy.id,
        botName: copy.name,
        level: 'INFO',
        event: 'bot.duplicated',
        message: `Bot duplicado a partir de "${source.name}".`
      });
      void syncBotRecordToDb(copy);

      return reply.status(201).send({ bot: copy });
    }
  );

  const togglePauseHandler = async (
    request: { params: { id: string }; user?: { organizationId?: string } },
    reply: { status: (code: number) => { send: (payload: unknown) => unknown } }
  ) => {
    const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
    const bot = runtimeStore.bots.find(
      (item) => item.id === request.params.id && item.organizationId === orgId
    );
    if (!bot) {
      return reply.status(404).send({
        error: 'BOT_NOT_FOUND',
        message: 'Bot no encontrado.'
      });
    }

    const willPause = bot.status !== 'PAUSED';
    bot.status = willPause ? 'PAUSED' : 'CONNECTED';
    bot.isActive = !willPause;
    bot.updatedAt = new Date().toISOString();
    runtimeStore.persistStateToDisk();
    void syncBotRecordToDb(bot);

    if (bot.driver === 'BAILEYS') {
      if (willPause) {
        await whatsappProvider.disconnectBot(bot.id, bot.organizationId, 'BAILEYS');
        bot.status = 'PAUSED';
        bot.isActive = false;
      } else {
        await whatsappProvider.connectBot(bot.id, bot.organizationId, 'BAILEYS');
      }
    }

    if (app.io) {
      app.io.emit('whatsapp:status', {
        botId: bot.id,
        status: bot.status,
        phoneNumber: bot.phoneNumber,
        driver: bot.driver,
        updatedAt: bot.updatedAt
      });
    }

    return { bot };
  };

  app.post<{ Params: { id: string } }>(
    '/:id/toggle-pause',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Bots'],
        summary: 'Pausar o reanudar bot'
      }
    },
    togglePauseHandler
  );

  app.post<{ Params: { id: string } }>(
    '/:id/toggle-active',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Bots'],
        summary: 'Alternar estado activo del bot'
      }
    },
    togglePauseHandler
  );

  app.post<{ Params: { id: string } }>(
    '/:id/qr/generate',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['WhatsApp'],
        summary: 'Iniciar sesión Baileys real y emitir código QR en vivo'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const bot = runtimeStore.bots.find(
        (item) => item.id === request.params.id && item.organizationId === orgId
      );
      if (!bot) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: 'Bot no encontrado.'
        });
      }

      if (app.io) {
        whatsappProvider.bindSocketServer(app.io);
      }
      await whatsappProvider.resetBotSession(bot.id, bot.organizationId, 'BAILEYS');
      return { bot };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/:id/disconnect',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['WhatsApp'],
        summary: 'Desconectar sesión activa de WhatsApp'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const bot = runtimeStore.bots.find(
        (item) => item.id === request.params.id && item.organizationId === orgId
      );
      if (!bot) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: 'Bot no encontrado.'
        });
      }

      if (app.io) {
        whatsappProvider.bindSocketServer(app.io);
      }
      await whatsappProvider.disconnectBot(bot.id, bot.organizationId, bot.driver);
      return { bot };
    }
  );

  app.put<{ Params: { id: string } }>(
    '/:id/chatwoot',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Chatwoot'],
        summary: 'Guardar credenciales de Chatwoot cifradas con AES-256-GCM'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const bot = runtimeStore.bots.find(
        (item) => item.id === request.params.id && item.organizationId === orgId
      );
      if (!bot) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: 'Bot no encontrado.'
        });
      }

      const parsed = ChatwootConfigInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Configuración de Chatwoot inválida.'
        });
      }

      try {
        await assertSafeExternalUrl(parsed.data.baseUrl, { allowSimulatedLocal: true });
      } catch (err) {
        return reply.status(400).send({
          error: 'SSRF_BLOCKED',
          message:
            err instanceof Error
              ? err.message
              : 'La URL de Chatwoot apunta a un destino no permitido.'
        });
      }

      const chatwootConfig = ChatwootService.saveConfig(bot.id, parsed.data);
      if (bot.driver === 'CHATWOOT') {
        try {
          await ChatwootService.testConnection(bot.id, app.io);
        } catch {
          void 0;
        }
      }
      return { chatwootConfig, bot };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/:id/chatwoot/test',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Chatwoot'],
        summary: 'Probar conexión real con el servidor e Inbox de Chatwoot'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const bot = runtimeStore.bots.find(
        (item) => item.id === request.params.id && item.organizationId === orgId
      );
      if (!bot) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: 'Bot no encontrado.'
        });
      }

      try {
        return await ChatwootService.testConnection(bot.id, app.io);
      } catch (err) {
        return reply.status(400).send({
          error: 'CHATWOOT_TEST_FAILED',
          message:
            err instanceof Error
              ? err.message
              : 'Error probando conexión con Chatwoot.',
          bot
        });
      }
    }
  );

  app.put<{ Params: { id: string } }>(
    '/:id/cloud-api',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['WhatsApp'],
        summary: 'Guardar credenciales de WhatsApp Cloud API oficial cifradas con AES-256-GCM'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const bot = runtimeStore.bots.find(
        (item) => item.id === request.params.id && item.organizationId === orgId
      );
      if (!bot) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: 'Bot no encontrado.'
        });
      }

      const parsed = CloudApiConfigInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Credenciales de WhatsApp Cloud API inválidas.'
        });
      }

      if (app.io) {
        whatsappProvider.bindSocketServer(app.io);
      }

      await whatsappProvider.saveCloudApiConfig(bot.id, bot.organizationId, {
        phoneNumberId: parsed.data.phoneNumberId,
        wabaId: parsed.data.wabaId,
        accessToken: parsed.data.accessToken,
        verifyToken: parsed.data.verifyToken,
        appSecret: parsed.data.appSecret || undefined
      });
      return { bot };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [app.requireRole(['ADMIN'])],
      schema: {
        tags: ['Bots'],
        summary: 'Eliminar bot de la organización'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const idx = runtimeStore.bots.findIndex(
        (item) => item.id === request.params.id && item.organizationId === orgId
      );
      if (idx === -1) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: 'Bot no encontrado.'
        });
      }
      const [removed] = runtimeStore.bots.splice(idx, 1);
      await whatsappProvider.disconnectBot(removed.id, removed.organizationId, removed.driver);
      void deleteBotFromDb(removed.id);
      runtimeStore.appendLog({
        botId: null,
        level: 'WARN',
        event: 'bot.deleted',
        message: `Bot "${removed.name}" eliminado de la organización.`
      });
      return { success: true };
    }
  );
}

export const registerBotRoutes = registerBotsRoutes;
