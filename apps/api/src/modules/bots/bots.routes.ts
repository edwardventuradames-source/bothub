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
import { createDefaultBusinessHours } from '../../lib/runtime-seed-graphs.js';
import { BaileysDriver, CloudApiDriver } from '../whatsapp/whatsapp.driver.js';
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
    async () => ({
      bots: runtimeStore.bots
    })
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
      const bot = runtimeStore.bots.find((item) => item.id === request.params.id);
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

      const data = parsed.data;
      const nowIso = new Date().toISOString();
      const matchedFlow = data.activeFlowId
        ? runtimeStore.flows.find((f) => f.id === data.activeFlowId) ?? null
        : runtimeStore.flows[0] ?? null;

      const newBot: BotDto = {
        id: `bot-${crypto.randomUUID().slice(0, 8)}`,
        organizationId: request.user.organizationId || DEFAULT_ORG_ID,
        name: data.name,
        description:
          data.description || 'Bot de WhatsApp integrado con Chatwoot.',
        phoneNumber: data.phoneNumber || '+57 300 000 0000',
        driver: data.driver,
        status: data.driver === 'BAILEYS' ? 'WAITING_QR' : 'DISCONNECTED',
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
        qrCodeData:
          data.driver === 'BAILEYS'
            ? `BOTHUB-WA-MD://2@${Date.now()}`
            : null,
        qrExpiresAt:
          data.driver === 'BAILEYS'
            ? new Date(Date.now() + 60_000).toISOString()
            : null,
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

      return reply.status(201).send({ bot: newBot });
    }
  );

  const updateHandler = async (
    request: { params: { id: string }; body: unknown },
    reply: { status: (code: number) => { send: (payload: unknown) => unknown } }
  ) => {
    const bot = runtimeStore.bots.find((item) => item.id === request.params.id);
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
        ? runtimeStore.flows.find((f) => f.id === patch.activeFlowId) ?? null
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
      const source = runtimeStore.bots.find((item) => item.id === request.params.id);
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

      return reply.status(201).send({ bot: copy });
    }
  );

  const togglePauseHandler = async (
    request: { params: { id: string } },
    reply: { status: (code: number) => { send: (payload: unknown) => unknown } }
  ) => {
    const bot = runtimeStore.bots.find((item) => item.id === request.params.id);
    if (!bot) {
      return reply.status(404).send({
        error: 'BOT_NOT_FOUND',
        message: 'Bot no encontrado.'
      });
    }

    const nextStatus = bot.status === 'PAUSED' ? 'CONNECTED' : 'PAUSED';
    const updated = BaileysDriver.setBotConnectionStatus(bot.id, nextStatus, app.io);
    return { bot: updated };
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
        summary: 'Generar nuevo código QR en vivo con Baileys'
      }
    },
    async (request, reply) => {
      try {
        const bot = BaileysDriver.requestNewQrCode(request.params.id, app.io);
        return { bot };
      } catch (err) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: err instanceof Error ? err.message : 'Bot no encontrado.'
        });
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/:id/qr/confirm',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['WhatsApp'],
        summary: 'Vincular sesión QR de Baileys y cifrar credenciales con AES-256-GCM'
      }
    },
    async (request, reply) => {
      try {
        const bot = BaileysDriver.completeQrPairing(request.params.id, app.io);
        return { bot };
      } catch (err) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: err instanceof Error ? err.message : 'Bot no encontrado.'
        });
      }
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
      try {
        const bot = BaileysDriver.setBotConnectionStatus(
          request.params.id,
          'DISCONNECTED',
          app.io
        );
        return { bot };
      } catch (err) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: err instanceof Error ? err.message : 'Bot no encontrado.'
        });
      }
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
      const parsed = ChatwootConfigInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Configuración de Chatwoot inválida.'
        });
      }

      const chatwootConfig = ChatwootService.saveConfig(request.params.id, parsed.data);
      const bot = runtimeStore.bots.find((item) => item.id === request.params.id);
      if (!bot) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: 'Bot no encontrado.'
        });
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
        summary: 'Probar conexión con el servidor e Inbox de Chatwoot'
      }
    },
    async (request, reply) => {
      try {
        return ChatwootService.testConnection(request.params.id);
      } catch (err) {
        return reply.status(400).send({
          error: 'CHATWOOT_TEST_FAILED',
          message:
            err instanceof Error
              ? err.message
              : 'Error probando conexión con Chatwoot.'
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
      const parsed = CloudApiConfigInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Credenciales de WhatsApp Cloud API inválidas.'
        });
      }

      try {
        const bot = CloudApiDriver.configureOfficialCloudApi(
          request.params.id,
          parsed.data
        );
        return { bot };
      } catch (err) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: err instanceof Error ? err.message : 'Bot no encontrado.'
        });
      }
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
      const idx = runtimeStore.bots.findIndex((item) => item.id === request.params.id);
      if (idx === -1) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: 'Bot no encontrado.'
        });
      }
      const [removed] = runtimeStore.bots.splice(idx, 1);
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
