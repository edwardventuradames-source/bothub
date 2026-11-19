import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import {
  CreateApiKeyInputSchema,
  CreateUserInputSchema,
  HandoffActionInputSchema,
  OutboundWebhookConfigInputSchema,
  UpdateContactInputSchema,
  UpdateUserInputSchema
} from '@bothub/shared';
import {
  DEFAULT_ORG_ID,
  runtimeStore
} from '../../lib/runtime-store.js';
import {
  isDatabaseConfigured,
  syncConversationStateToDb
} from '../../lib/persistence.js';
import { prisma } from '../../lib/prisma.js';
import { assertSafeExternalUrl } from '../../lib/ssrf-guard.js';
import { bumpUserTokenVersion } from '../auth/auth.service.js';
import { toggleChatwootConversationStatusApi } from '../chatwoot/chatwoot.client.js';
import { ChatwootService, ChatwootWebhookPayload } from '../chatwoot/chatwoot.service.js';
import { BotNotFoundError } from '../whatsapp/inbound-pipeline.js';
import { whatsappProvider } from '../whatsapp/whatsapp.provider.js';

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
    async (request) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const orgBots = runtimeStore.bots.filter((b) => b.organizationId === orgId);
      const orgBotIds = new Set(orgBots.map((b) => b.id));
      return {
        metrics: runtimeStore.getDashboardMetrics(orgId),
        bots: orgBots,
        recentLogs: runtimeStore.logs
          .filter((l) =>
            l.organizationId
              ? l.organizationId === orgId
              : Boolean(l.botId && orgBotIds.has(l.botId))
          )
          .slice(0, 8)
      };
    }
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
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const orgBotIds = new Set(
        runtimeStore.bots.filter((b) => b.organizationId === orgId).map((b) => b.id)
      );
      const { status, botId } = request.query;
      const filtered = runtimeStore.conversations.filter((conv) => {
        if (!orgBotIds.has(conv.botId)) {
          return false;
        }
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
      const parsed = HandoffActionInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Acción de handoff inválida.',
          details: parsed.error.flatten()
        });
      }

      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const orgBotIds = new Set(
        runtimeStore.bots.filter((b) => b.organizationId === orgId).map((b) => b.id)
      );
      const conversation = runtimeStore.conversations.find(
        (item) => item.id === request.params.id && orgBotIds.has(item.botId)
      );
      if (!conversation) {
        return reply.status(404).send({
          error: 'CONVERSATION_NOT_FOUND',
          message: 'Conversación no encontrada.'
        });
      }

      const cwConfig = runtimeStore.getChatwootConfigDto(conversation.botId);
      const cwTokens = runtimeStore.getDecryptedChatwootTokens(conversation.botId);

      if (parsed.data.action === 'RETURN_TO_BOT') {
        conversation.status = 'BOT_ACTIVE';
        conversation.assignedAgentName = null;
        conversation.handoffReason = null;
        conversation.currentNodeId = null;
        conversation.messages.push({
          id: `msg-${crypto.randomUUID().slice(0, 8)}`,
          senderType: 'SYSTEM',
          senderName: 'BotHub Control',
          content: '🤖 Control devuelto al bot automático (#bot).',
          createdAt: new Date().toISOString()
        });
        if (cwConfig && cwTokens && conversation.chatwootConversationId) {
          await toggleChatwootConversationStatusApi({
            config: cwConfig,
            apiAccessToken: cwTokens.apiAccessToken,
            conversationId: conversation.chatwootConversationId,
            status: 'pending'
          });
        }
      } else {
        conversation.status = 'PENDING_AGENT';
        conversation.handoffReason =
          parsed.data.reason ?? 'Transferencia manual desde el panel BotHub.';
        conversation.messages.push({
          id: `msg-${crypto.randomUUID().slice(0, 8)}`,
          senderType: 'SYSTEM',
          senderName: 'Chatwoot Handoff Engine',
          content: `👨‍💼 Conversación transferida a Chatwoot: ${conversation.handoffReason}`,
          createdAt: new Date().toISOString()
        });
        if (cwConfig && cwTokens && conversation.chatwootConversationId) {
          await toggleChatwootConversationStatusApi({
            config: cwConfig,
            apiAccessToken: cwTokens.apiAccessToken,
            conversationId: conversation.chatwootConversationId,
            status: 'open'
          });
        }
      }

      conversation.lastActivityAt = new Date().toISOString();
      runtimeStore.persistStateToDisk();
      const contact = runtimeStore.contacts.find((c) => c.id === conversation.contactId);
      if (contact) {
        void syncConversationStateToDb(contact, conversation);
      }
      if (app.io) {
        app.io.to(`org:${orgId}`).emit('conversation:updated', conversation);
      }
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
    async (request) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      return {
        contacts: runtimeStore.contacts.filter((c) => c.organizationId === orgId)
      };
    }
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
      const parsed = UpdateContactInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Datos de contacto inválidos.',
          details: parsed.error.flatten()
        });
      }

      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const contact = runtimeStore.contacts.find(
        (c) => c.id === request.params.id && c.organizationId === orgId
      );
      if (!contact) {
        return reply.status(404).send({
          error: 'CONTACT_NOT_FOUND',
          message: 'Contacto no encontrado.'
        });
      }
      if (parsed.data.tags) {
        contact.tags = parsed.data.tags;
      }
      if (parsed.data.variables) {
        contact.variables = { ...contact.variables, ...parsed.data.variables };
      }
      contact.lastInteractionAt = new Date().toISOString();
      runtimeStore.persistStateToDisk();
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
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const orgBotIds = new Set(
        runtimeStore.bots.filter((b) => b.organizationId === orgId).map((b) => b.id)
      );
      const { level, botId } = request.query;
      const logs = runtimeStore.logs.filter((entry) => {
        if (entry.organizationId) {
          if (entry.organizationId !== orgId) {
            return false;
          }
        } else if (!entry.botId || !orgBotIds.has(entry.botId)) {
          return false;
        }
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
    async (request) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      return {
        users: runtimeStore.users
          .filter((u) => u.organizationId === orgId)
          .map(({ passwordHash: _ignored, ...publicUser }) => publicUser)
      };
    }
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

      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const creatorRecord = runtimeStore.users.find((u) => u.organizationId === orgId);
      const organizationName = creatorRecord?.organizationName ?? 'Mi Organización';
      const nowIso = new Date().toISOString();
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      let userId: string = crypto.randomUUID();

      if (isDatabaseConfigured()) {
        try {
          const dbUser = await prisma.user.create({
            data: {
              id: userId,
              organizationId: orgId,
              email: parsed.data.email.toLowerCase(),
              passwordHash,
              name: parsed.data.name,
              role: parsed.data.role,
              isActive: true
            }
          });
          userId = dbUser.id;
        } catch {
          void 0;
        }
      }

      const newUser = {
        id: userId,
        organizationId: orgId,
        organizationName,
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        role: parsed.data.role,
        isActive: true,
        lastLoginAt: null,
        createdAt: nowIso,
        passwordHash,
        tokenVersion: 1
      };

      runtimeStore.users.push(newUser);
      runtimeStore.persistUsersToDisk();
      const { passwordHash: _ignored, tokenVersion: _tv, ...publicUser } = newUser;
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
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const user = runtimeStore.users.find(
        (u) => u.id === request.params.id && u.organizationId === orgId
      );
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

      const activeAdminsInOrg = runtimeStore.users.filter(
        (u) => u.organizationId === orgId && u.role === 'ADMIN' && u.isActive
      );
      const isLastActiveAdmin =
        user.role === 'ADMIN' && user.isActive && activeAdminsInOrg.length <= 1;
      if (
        isLastActiveAdmin &&
        (parsed.data.isActive === false ||
          (parsed.data.role !== undefined && parsed.data.role !== 'ADMIN'))
      ) {
        return reply.status(409).send({
          error: 'LAST_ADMIN_PROTECTED',
          message: 'No puedes suspender ni degradar al último administrador activo de la organización.'
        });
      }

      const shouldRevokeSessions =
        (parsed.data.isActive !== undefined && parsed.data.isActive !== user.isActive) ||
        (parsed.data.role !== undefined && parsed.data.role !== user.role);

      if (parsed.data.name !== undefined) user.name = parsed.data.name;
      if (parsed.data.role !== undefined) user.role = parsed.data.role;
      if (parsed.data.isActive !== undefined) user.isActive = parsed.data.isActive;

      if (isDatabaseConfigured()) {
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              name: user.name,
              role: user.role,
              isActive: user.isActive
            }
          });
          if (shouldRevokeSessions) {
            await prisma.refreshToken.updateMany({
              where: { userId: user.id, revokedAt: null },
              data: { revokedAt: new Date() }
            });
          }
        } catch {
          void 0;
        }
      }

      if (shouldRevokeSessions) {
        bumpUserTokenVersion(user.id);
      } else {
        runtimeStore.persistUsersToDisk();
      }

      const { passwordHash: _ignored, tokenVersion: _tv, ...publicUser } = user;
      return { user: publicUser };
    }
  );

  app.get(
    '/settings/overview',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['System'],
        summary: 'Obtener API Keys y configuración de Webhooks salientes de la organización'
      }
    },
    async (request) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      return {
        apiKeys:
          request.user.role === 'ADMIN'
            ? runtimeStore.getPublicApiKeys(orgId)
            : [],
        outboundWebhooks: runtimeStore.getPublicOutboundWebhooks(orgId)
      };
    }
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
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const apiKey = runtimeStore.createApiKey(
        orgId,
        parsed.data.name,
        parsed.data.scopes
      );
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
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const existing = runtimeStore.apiKeys.find(
        (k) => k.id === request.params.id && k.organizationId === orgId
      );
      if (!existing) {
        return reply.status(404).send({
          error: 'API_KEY_NOT_FOUND',
          message: 'API Key no encontrada en la organización.'
        });
      }
      runtimeStore.apiKeys = runtimeStore.apiKeys.filter(
        (k) => !(k.id === request.params.id && k.organizationId === orgId)
      );
      runtimeStore.persistStateToDisk();
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

      try {
        await assertSafeExternalUrl(parsed.data.targetUrl);
      } catch (err) {
        return reply.status(400).send({
          error: 'SSRF_BLOCKED',
          message:
            err instanceof Error
              ? err.message
              : 'La URL destino del webhook no está permitida por seguridad SSRF.'
        });
      }

      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const webhook = runtimeStore.createOutboundWebhook(orgId, {
        name: parsed.data.name,
        targetUrl: parsed.data.targetUrl,
        events: parsed.data.events,
        secretToken: parsed.data.secretToken,
        isActive: parsed.data.isActive
      });
      return reply.status(201).send({ webhook });
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/settings/webhooks/:id',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['System'],
        summary: 'Eliminar webhook saliente de la organización'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const existing = runtimeStore.outboundWebhooks.find(
        (w) => w.id === request.params.id && w.organizationId === orgId
      );
      if (!existing) {
        return reply.status(404).send({
          error: 'WEBHOOK_NOT_FOUND',
          message: 'Webhook saliente no encontrado.'
        });
      }
      runtimeStore.outboundWebhooks = runtimeStore.outboundWebhooks.filter(
        (w) => !(w.id === request.params.id && w.organizationId === orgId)
      );
      runtimeStore.persistStateToDisk();
      return { success: true };
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
        const message = err instanceof Error ? err.message : 'Error validando webhook.';
        const statusCode = message.includes('no encontrado') ? 404 : 401;
        return reply.status(statusCode).send({
          error: statusCode === 404 ? 'BOT_NOT_FOUND' : 'WEBHOOK_UNAUTHORIZED',
          message
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
      const result = whatsappProvider.verifyCloudWebhookSubscription(
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
    Headers: { 'x-hub-signature-256'?: string };
    Body: unknown;
  }>(
    '/webhooks/whatsapp-cloud/:botId',
    {
      schema: {
        tags: ['Webhooks'],
        summary: 'Recepción verificada de mensajes entrantes de WhatsApp Cloud API (Meta)'
      }
    },
    async (request, reply) => {
      const { botId } = request.params;
      const bot = runtimeStore.bots.find((item) => item.id === botId);
      if (!bot) {
        return reply.status(404).send({
          error: 'BOT_NOT_FOUND',
          message: 'Bot no encontrado para este webhook.'
        });
      }

      const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
      const signature = request.headers['x-hub-signature-256'];
      const sigValidation = whatsappProvider.verifyCloudWebhookSignature(
        botId,
        rawBody,
        signature
      );
      if (!sigValidation.valid) {
        return reply.status(401).send({
          error: 'CLOUD_SIGNATURE_INVALID',
          message: `Firma del webhook inválida (${sigValidation.reason ?? 'unauthorized'}).`
        });
      }

      const parsed = whatsappProvider.parseCloudWebhookPayload(request.body);
      if (!parsed.validStructure) {
        return reply.status(400).send({
          error: 'INVALID_WEBHOOK_PAYLOAD',
          message: 'El payload no cumple la estructura oficial de WhatsApp Cloud API (Meta).'
        });
      }

      if (parsed.isStatusOnly) {
        return {
          accepted: true,
          action: 'status_update_ignored'
        };
      }

      const results = [];
      for (const msg of parsed.messages) {
        try {
          const res = await whatsappProvider.handleCloudWebhookMessage(
            botId,
            msg,
            app.io
          );
          results.push(res);
        } catch (err) {
          if (err instanceof BotNotFoundError) {
            return reply.status(404).send({
              error: 'BOT_NOT_FOUND',
              message: err.message
            });
          }
          throw err;
        }
      }

      return {
        accepted: true,
        action: results[0]?.action ?? 'processed',
        processedCount: results.length,
        conversation: results[0]?.conversation,
        simulation: results[0]?.simulation
      };
    }
  );
}
