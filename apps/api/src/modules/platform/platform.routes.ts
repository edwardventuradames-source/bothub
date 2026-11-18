import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import {
  CreateApiKeyInputSchema,
  CreateUserInputSchema,
  OutboundWebhookConfigInputSchema,
  UpdateUserInputSchema
} from '@bothub/shared';
import {
  DEFAULT_ORG_ID,
  maskSecretValue,
  runtimeStore
} from '../../lib/runtime-store.js';
import { ChatwootService, ChatwootWebhookPayload } from '../chatwoot/chatwoot.service.js';
import { CloudApiDriver } from '../whatsapp/whatsapp.driver.js';

export async function registerPlatformRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/dashboard/metrics',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['System'],
        summary: 'Métricas en tiempo real del Dashboard Soft UI'
      }
    },
    async () => ({
      metrics: runtimeStore.getDashboardMetrics(),
      bots: runtimeStore.bots,
      recentLogs: runtimeStore.logs.slice(0, 8)
    })
  );

  app.get<{ Querystring: { status?: string; botId?: string } }>(
    '/conversations',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Conversations'],
        summary: 'Listar conversaciones sincronizadas con trazabilidad de nodos'
      }
    },
    async (request) => {
      const { status, botId } = request.query;
      const filtered = runtimeStore.conversations.filter((conv) => {
        if (status && status !== 'ALL' && conv.status !== status) {
          return false;
        }
        if (botId && botId !== 'ALL' && conv.botId !== botId) {
          return false;
        }
        return true;
      });
      return { conversations: filtered };
    }
  );

  app.post<{
    Params: { id: string };
    Body: { action: 'RETURN_TO_BOT' | 'TRANSFER_TO_AGENT'; reason?: string };
  }>(
    '/conversations/:id/handoff',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Conversations'],
        summary: 'Transferir conversación a agente humano o devolver control al bot'
      }
    },
    async (request, reply) => {
      const conversation = runtimeStore.conversations.find(
        (item) => item.id === request.params.id
      );
      if (!conversation) {
        return reply.status(404).send({
          error: 'CONVERSATION_NOT_FOUND',
          message: 'Conversación no encontrada.'
        });
      }

      if (request.body.action === 'RETURN_TO_BOT') {
        conversation.status = 'BOT_ACTIVE';
        conversation.assignedAgentName = null;
        conversation.handoffReason = null;
        conversation.messages.push({
          id: `msg-${crypto.randomUUID().slice(0, 8)}`,
          senderType: 'SYSTEM',
          senderName: 'BotHub Control',
          content: '🤖 Control devuelto al bot automático (#bot).',
          createdAt: new Date().toISOString()
        });
      } else {
        conversation.status = 'PENDING_AGENT';
        conversation.handoffReason =
          request.body.reason ?? 'Transferencia manual desde el panel BotHub.';
        conversation.messages.push({
          id: `msg-${crypto.randomUUID().slice(0, 8)}`,
          senderType: 'SYSTEM',
          senderName: 'Chatwoot Handoff Engine',
          content: `👨‍💼 Conversación transferida a Chatwoot: ${conversation.handoffReason}`,
          createdAt: new Date().toISOString()
        });
      }

      conversation.lastActivityAt = new Date().toISOString();
      return { conversation };
    }
  );

  app.get(
    '/contacts',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Contacts'],
        summary: 'Listar contactos y variables dinámicas capturadas'
      }
    },
    async () => ({
      contacts: runtimeStore.contacts
    })
  );

  app.put<{
    Params: { id: string };
    Body: { tags?: string[]; variables?: Record<string, string> };
  }>(
    '/contacts/:id',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Contacts'],
        summary: 'Actualizar etiquetas o variables de un contacto'
      }
    },
    async (request, reply) => {
      const contact = runtimeStore.contacts.find((c) => c.id === request.params.id);
      if (!contact) {
        return reply.status(404).send({
          error: 'CONTACT_NOT_FOUND',
          message: 'Contacto no encontrado.'
        });
      }
      if (request.body.tags) {
        contact.tags = request.body.tags;
      }
      if (request.body.variables) {
        contact.variables = { ...contact.variables, ...request.body.variables };
      }
      contact.lastInteractionAt = new Date().toISOString();
      return { contact };
    }
  );

  app.get<{ Querystring: { level?: string; botId?: string } }>(
    '/logs',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Logs'],
        summary: 'Consultar logs estructurados y eventos en tiempo real'
      }
    },
    async (request) => {
      const { level, botId } = request.query;
      const logs = runtimeStore.logs.filter((entry) => {
        if (level && level !== 'ALL' && entry.level !== level) {
          return false;
        }
        if (botId && botId !== 'ALL' && entry.botId !== botId) {
          return false;
        }
        return true;
      });
      return { logs };
    }
  );

  app.get(
    '/users',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Listar usuarios y roles RBAC de la organización'
      }
    },
    async () => ({
      users: runtimeStore.users.map(({ passwordHash: _ignored, ...publicUser }) => publicUser)
    })
  );

  app.post(
    '/users',
    {
      preHandler: [app.requireRole(['ADMIN'])],
      schema: {
        tags: ['Users'],
        summary: 'Crear nuevo usuario en la organización (Solo ADMIN)'
      }
    },
    async (request, reply) => {
      const parsed = CreateUserInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Datos de usuario inválidos.',
          details: parsed.error.flatten()
        });
      }

      const exists = runtimeStore.users.some(
        (u) => u.email.toLowerCase() === parsed.data.email.toLowerCase()
      );
      if (exists) {
        return reply.status(409).send({
          error: 'EMAIL_ALREADY_EXISTS',
          message: 'Ya existe un usuario con ese correo electrónico.'
        });
      }

      const nowIso = new Date().toISOString();
      const newUser = {
        id: crypto.randomUUID(),
        organizationId: request.user?.organizationId ?? DEFAULT_ORG_ID,
        organizationName: 'BotHub Enterprise',
        name: parsed.data.name,
        email: parsed.data.email,
        role: parsed.data.role,
        isActive: true,
        lastLoginAt: null,
        createdAt: nowIso,
        passwordHash: await bcrypt.hash(parsed.data.password, 10)
      };

      runtimeStore.users.push(newUser);
      const { passwordHash: _ignored, ...publicUser } = newUser;
      return reply.status(201).send({ user: publicUser });
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/users/:id',
    {
      preHandler: [app.requireRole(['ADMIN'])],
      schema: {
        tags: ['Users'],
        summary: 'Modificar rol o estado activo de un usuario'
      }
    },
    async (request, reply) => {
      const user = runtimeStore.users.find((u) => u.id === request.params.id);
      if (!user) {
        return reply.status(404).send({
          error: 'USER_NOT_FOUND',
          message: 'Usuario no encontrado.'
        });
      }

      const parsed = UpdateUserInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Datos inválidos.'
        });
      }

      if (parsed.data.name !== undefined) user.name = parsed.data.name;
      if (parsed.data.role !== undefined) user.role = parsed.data.role;
      if (parsed.data.isActive !== undefined) user.isActive = parsed.data.isActive;

      const { passwordHash: _ignored, ...publicUser } = user;
      return { user: publicUser };
    }
  );

  app.get(
    '/settings/overview',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['System'],
        summary: 'Obtener API Keys y configuración de Webhooks salientes'
      }
    },
    async () => ({
      apiKeys: runtimeStore.apiKeys,
      outboundWebhooks: runtimeStore.outboundWebhooks
    })
  );

  app.post(
    '/settings/api-keys',
    {
      preHandler: [app.requireRole(['ADMIN'])],
      schema: {
        tags: ['System'],
        summary: 'Generar nueva API Key con CSPRNG'
      }
    },
    async (request, reply) => {
      const parsed = CreateApiKeyInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Nombre de API Key inválido.'
        });
      }
      const apiKey = runtimeStore.createApiKey(parsed.data.name, parsed.data.scopes);
      return reply.status(201).send({ apiKey });
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/settings/api-keys/:id',
    {
      preHandler: [app.requireRole(['ADMIN'])],
      schema: {
        tags: ['System'],
        summary: 'Revocar API Key'
      }
    },
    async (request) => {
      runtimeStore.apiKeys = runtimeStore.apiKeys.filter(
        (k) => k.id !== request.params.id
      );
      return { success: true };
    }
  );

  app.post(
    '/settings/webhooks',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['System'],
        summary: 'Registrar nuevo webhook saliente cifrado'
      }
    },
    async (request, reply) => {
      const parsed = OutboundWebhookConfigInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Configuración de webhook inválida.'
        });
      }

      const webhook = {
        id: `wh-out-${crypto.randomUUID().slice(0, 8)}`,
        name: parsed.data.name,
        targetUrl: parsed.data.targetUrl,
        events: parsed.data.events,
        maskedSecret: maskSecretValue(parsed.data.secretToken),
        isActive: parsed.data.isActive,
        createdAt: new Date().toISOString()
      };
      runtimeStore.outboundWebhooks.unshift(webhook);
      return reply.status(201).send({ webhook });
    }
  );

  app.post<{
    Params: { botId: string };
    Headers: { 'x-chatwoot-webhook-token'?: string };
    Body: ChatwootWebhookPayload;
  }>(
    '/webhooks/chatwoot/:botId',
    {
      schema: {
        tags: ['Webhooks'],
        summary: 'Receptor de eventos salientes de Chatwoot (Agente -> WhatsApp y retorno #bot)'
      }
    },
    async (request, reply) => {
      const token =
        request.headers['x-chatwoot-webhook-token'] ??
        (request.query as Record<string, string | undefined>).token;
      try {
        const result = await ChatwootService.processWebhookEvent(
          request.params.botId,
          token,
          request.body,
          app.io
        );
        return result;
      } catch (err) {
        return reply.status(401).send({
          error: 'WEBHOOK_UNAUTHORIZED',
          message: err instanceof Error ? err.message : 'Error validando webhook.'
        });
      }
    }
  );

  app.get<{
    Params: { botId: string };
    Querystring: {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };
  }>(
    '/webhooks/whatsapp-cloud/:botId',
    {
      schema: {
        tags: ['Webhooks'],
        summary: 'Verificación de webhook oficial de WhatsApp Cloud API (Meta)'
      }
    },
    async (request, reply) => {
      const result = CloudApiDriver.verifyWebhookSubscription(
        request.params.botId,
        request.query['hub.mode'],
        request.query['hub.verify_token'],
        request.query['hub.challenge']
      );
      if (!result.verified) {
        return reply.status(403).send({
          error: 'CLOUD_WEBHOOK_FORBIDDEN',
          message: 'Verify token inválido.'
        });
      }
      return reply.type('text/plain').send(result.challengeResponse);
    }
  );

  app.post<{
    Params: { botId: string };
    Body: { fromPhone?: string; contactName?: string; text?: string };
  }>(
    '/webhooks/whatsapp-cloud/:botId',
    {
      schema: {
        tags: ['Webhooks'],
        summary: 'Recepción de mensajes entrantes de WhatsApp Cloud API'
      }
    },
    async (request) => {
      const fromPhone = request.body?.fromPhone ?? '+57 300 999 8877';
      const contactName = request.body?.contactName ?? 'Cliente WhatsApp Cloud';
      const text = request.body?.text ?? 'hola';

      return CloudApiDriver.handleIncomingWhatsAppMessage(
        request.params.botId,
        { fromPhone, contactName, text },
        app.io
      );
    }
  );
}
