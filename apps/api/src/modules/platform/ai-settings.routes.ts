import { FastifyInstance } from 'fastify';
import {
  AiProviderIdSchema,
  UpdateAiTokenBudgetInputSchema,
  UpsertAiProviderKeyInputSchema
} from '@bothub/shared';
import { DEFAULT_ORG_ID, runtimeStore } from '../../lib/runtime-store.js';
import {
  deleteAiCredentialFromDb,
  syncAiCredentialToDb,
  syncAiTokenBudgetToDb
} from '../../lib/persistence.js';

export async function registerAiSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/settings/ai-providers',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['System'],
        summary: 'Consultar proveedores de IA y presupuesto mensual de tokens de la organización'
      }
    },
    async (request) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      return {
        aiProviders: runtimeStore.getAllAiProviderStatuses(orgId),
        aiTokenBudget: runtimeStore.getAiTokenBudget(orgId)
      };
    }
  );

  app.put(
    '/settings/ai-providers',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['System'],
        summary: 'Guardar API Key cifrada de OpenAI, Gemini o Anthropic para nodos IA'
      }
    },
    async (request, reply) => {
      const parsed = UpsertAiProviderKeyInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Proveedor inválido o API Key demasiado corta (mín. 10 caracteres).'
        });
      }
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const record = runtimeStore.saveAiCredential(
        orgId,
        parsed.data.provider,
        parsed.data.apiKey
      );
      void syncAiCredentialToDb(record);
      return {
        provider: runtimeStore.getAiCredentialStatus(orgId, parsed.data.provider),
        aiProviders: runtimeStore.getAllAiProviderStatuses(orgId),
        aiTokenBudget: runtimeStore.getAiTokenBudget(orgId)
      };
    }
  );

  app.delete<{ Params: { provider: string } }>(
    '/settings/ai-providers/:provider',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['System'],
        summary: 'Eliminar API Key de IA almacenada en la organización'
      }
    },
    async (request, reply) => {
      const parsedProvider = AiProviderIdSchema.safeParse(request.params.provider);
      if (!parsedProvider.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Proveedor de IA inválido.'
        });
      }
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      runtimeStore.deleteAiCredential(orgId, parsedProvider.data);
      void deleteAiCredentialFromDb(orgId, parsedProvider.data);
      return {
        success: true,
        aiProviders: runtimeStore.getAllAiProviderStatuses(orgId),
        aiTokenBudget: runtimeStore.getAiTokenBudget(orgId)
      };
    }
  );

  app.put(
    '/settings/ai-budget',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['System'],
        summary: 'Configurar límite mensual de tokens IA y reinicio de contador'
      }
    },
    async (request, reply) => {
      const parsed = UpdateAiTokenBudgetInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Límite de tokens inválido (debe ser un entero entre 0 y 100,000,000).'
        });
      }
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const saved = runtimeStore.updateAiTokenBudget(orgId, parsed.data);
      void syncAiTokenBudgetToDb(saved);
      return {
        aiTokenBudget: runtimeStore.getAiTokenBudget(orgId)
      };
    }
  );
}
