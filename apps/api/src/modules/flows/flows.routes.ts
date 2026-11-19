import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import {
  CreateFlowInputSchema,
  FlowDto,
  FlowSimulationRequestSchema,
  SaveFlowGraphInputSchema
} from '@bothub/shared';
import { DEFAULT_ORG_ID, runtimeStore } from '../../lib/runtime-store.js';
import { deleteFlowFromDb, syncBotRecordToDb, syncFlowToDb } from '../../lib/persistence.js';
import { executeFlowSimulationStep } from './flow.engine.js';

export async function registerFlowsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Flows'],
        summary: 'Listar todos los flujos conversacionales'
      }
    },
    async (request) => ({
      flows: runtimeStore.flows.filter(
        (item) => item.organizationId === (request.user?.organizationId ?? DEFAULT_ORG_ID)
      )
    })
  );

  app.get<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Flows'],
        summary: 'Obtener detalle de un flujo con sus nodos y conexiones'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const flow = runtimeStore.flows.find(
        (item) => item.id === request.params.id && item.organizationId === orgId
      );
      if (!flow) {
        return reply.status(404).send({
          error: 'FLOW_NOT_FOUND',
          message: 'El flujo solicitado no existe.'
        });
      }
      return { flow };
    }
  );

  app.post(
    '/',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Flows'],
        summary: 'Crear un nuevo flujo visual con plantilla inicial'
      }
    },
    async (request, reply) => {
      const parsed = CreateFlowInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Datos de creación de flujo inválidos.',
          details: parsed.error.flatten()
        });
      }

      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const data = parsed.data;
      const nowIso = new Date().toISOString();
      const targetBot = data.botId
        ? runtimeStore.bots.find((b) => b.id === data.botId && b.organizationId === orgId)
        : null;

      const starterNodes = [
        {
          id: 'node-trigger-start',
          type: 'TRIGGER' as const,
          position: { x: 80, y: 150 },
          data: {
            title: 'Disparador de Inicio',
            matchMode: 'FIRST_MESSAGE',
            keyword: 'hola, menu'
          }
        },
        {
          id: 'node-msg-1',
          type: 'MESSAGE' as const,
          position: { x: 380, y: 150 },
          data: {
            title: 'Mensaje de Bienvenida',
            text: '¡Hola {{nombre}}! 👋 Bienvenido a nuestro canal de atención.'
          }
        }
      ];

      const starterEdges = [
        {
          id: 'edge-start-1',
          source: 'node-trigger-start',
          target: 'node-msg-1',
          label: 'Inicio'
        }
      ];

      const initialDraftVersion = {
        id: `fv-${crypto.randomUUID().slice(0, 8)}`,
        versionNumber: 1,
        status: 'DRAFT' as const,
        nodes: starterNodes,
        edges: starterEdges,
        publishedAt: null,
        createdAt: nowIso
      };

      const newFlow: FlowDto = {
        id: `flow-${crypto.randomUUID().slice(0, 8)}`,
        organizationId: request.user?.organizationId ?? DEFAULT_ORG_ID,
        name: data.name,
        description:
          data.description ?? 'Flujo visual configurable para atención en WhatsApp.',
        botId: targetBot?.id ?? null,
        botName: targetBot?.name ?? null,
        isMainMenu: data.isMainMenu,
        activeVersionNumber: 1,
        draftVersion: initialDraftVersion,
        publishedVersion: null,
        versions: [structuredClone(initialDraftVersion)],
        createdAt: nowIso,
        updatedAt: nowIso
      };

      runtimeStore.flows.unshift(newFlow);
      if (targetBot) {
        targetBot.activeFlowId = newFlow.id;
        targetBot.activeFlowName = newFlow.name;
        void syncBotRecordToDb(targetBot);
      }

      runtimeStore.appendLog({
        organizationId: orgId,
        botId: targetBot?.id ?? null,
        level: 'INFO',
        event: 'flow.created',
        message: `Flujo "${newFlow.name}" creado exitosamente.`
      });
      void syncFlowToDb(newFlow);

      return reply.status(201).send({ flow: newFlow });
    }
  );

  app.put<{ Params: { id: string } }>(
    '/:id/graph',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Flows'],
        summary: 'Guardar borrador o publicar nueva versión del grafo React Flow'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const flow = runtimeStore.flows.find(
        (item) => item.id === request.params.id && item.organizationId === orgId
      );
      if (!flow) {
        return reply.status(404).send({
          error: 'FLOW_NOT_FOUND',
          message: 'El flujo no existe.'
        });
      }

      const parsed = SaveFlowGraphInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'El grafo enviado contiene errores de estructura.',
          details: parsed.error.flatten()
        });
      }

      const data = parsed.data;
      const nowIso = new Date().toISOString();

      if (data.name !== undefined) flow.name = data.name;
      if (data.description !== undefined) flow.description = data.description;
      if (data.botId !== undefined) {
        flow.botId = data.botId;
        const matchedBot = runtimeStore.bots.find(
          (b) => b.id === data.botId && b.organizationId === orgId
        );
        flow.botName = matchedBot ? matchedBot.name : null;
        if (matchedBot) {
          matchedBot.activeFlowId = flow.id;
          matchedBot.activeFlowName = flow.name;
        }
      }

      const nextVersionNum = data.publish
        ? flow.activeVersionNumber + 1
        : flow.draftVersion.versionNumber;

      const savedSnapshot = {
        id: `fv-${crypto.randomUUID().slice(0, 8)}`,
        versionNumber: nextVersionNum,
        status: data.publish ? ('PUBLISHED' as const) : ('DRAFT' as const),
        nodes: data.nodes,
        edges: data.edges,
        publishedAt: data.publish ? nowIso : null,
        createdAt: nowIso
      };

      flow.draftVersion = savedSnapshot;

      if (!Array.isArray(flow.versions)) {
        flow.versions = [];
      }
      flow.versions.unshift(structuredClone(savedSnapshot));
      if (flow.versions.length > 25) {
        flow.versions = flow.versions.slice(0, 25);
      }

      if (data.publish) {
        flow.activeVersionNumber = nextVersionNum;
        flow.publishedVersion = structuredClone(flow.draftVersion);
      }

      flow.updatedAt = nowIso;

      runtimeStore.appendLog({
        organizationId: orgId,
        botId: flow.botId,
        level: 'INFO',
        event: data.publish ? 'flow.published' : 'flow.draft_saved',
        message: data.publish
          ? `Flujo "${flow.name}" publicado en versión v${flow.activeVersionNumber} (${data.nodes.length} nodos).`
          : `Borrador guardado en "${flow.name}" (${data.nodes.length} nodos, ${data.edges.length} conexiones).`
      });
      void syncFlowToDb(flow);

      return { flow };
    }
  );

  app.post<{ Params: { id: string; versionId: string } }>(
    '/:id/versions/:versionId/restore',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Flows'],
        summary: 'Restaurar una versión anterior del flujo'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const flow = runtimeStore.flows.find(
        (item) => item.id === request.params.id && item.organizationId === orgId
      );
      if (!flow) {
        return reply.status(404).send({
          error: 'FLOW_NOT_FOUND',
          message: 'El flujo no existe.'
        });
      }

      const history = Array.isArray(flow.versions) ? flow.versions : [];
      const targetVersion = history.find((v) => v.id === request.params.versionId);
      if (!targetVersion) {
        return reply.status(404).send({
          error: 'VERSION_NOT_FOUND',
          message: 'La versión solicitada no existe en el historial.'
        });
      }

      const nowIso = new Date().toISOString();
      flow.draftVersion = structuredClone(targetVersion);
      flow.activeVersionNumber = targetVersion.versionNumber;
      if (targetVersion.status === 'PUBLISHED') {
        flow.publishedVersion = structuredClone(targetVersion);
      }
      flow.updatedAt = nowIso;

      runtimeStore.appendLog({
        organizationId: orgId,
        botId: flow.botId,
        level: 'INFO',
        event: 'flow.version_restored',
        message: `Flujo "${flow.name}" restaurado a la versión v${targetVersion.versionNumber} (${targetVersion.status}).`
      });
      void syncFlowToDb(flow);

      return { flow };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/:id/simulate',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Flows'],
        summary: 'Ejecutar un paso en el probador interactivo del flujo'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const flow = runtimeStore.flows.find(
        (item) => item.id === request.params.id && item.organizationId === orgId
      );
      if (!flow) {
        return reply.status(404).send({
          error: 'FLOW_NOT_FOUND',
          message: 'El flujo no existe.'
        });
      }

      const parsed = FlowSimulationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Solicitud de simulación inválida.'
        });
      }

      const result = await executeFlowSimulationStep(
        flow.draftVersion.nodes,
        flow.draftVersion.edges,
        parsed.data
      );

      return result;
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Flows'],
        summary: 'Eliminar un flujo'
      }
    },
    async (request, reply) => {
      const orgId = request.user?.organizationId ?? DEFAULT_ORG_ID;
      const idx = runtimeStore.flows.findIndex(
        (f) => f.id === request.params.id && f.organizationId === orgId
      );
      if (idx === -1) {
        return reply.status(404).send({
          error: 'FLOW_NOT_FOUND',
          message: 'El flujo no existe.'
        });
      }
      const [removedFlow] = runtimeStore.flows.splice(idx, 1);
      for (const bot of runtimeStore.bots) {
        if (bot.organizationId === orgId && bot.activeFlowId === removedFlow.id) {
          bot.activeFlowId = null;
          bot.activeFlowName = null;
          void syncBotRecordToDb(bot);
        }
      }
      runtimeStore.appendLog({
        organizationId: orgId,
        botId: removedFlow.botId,
        level: 'WARN',
        event: 'flow.deleted',
        message: `Flujo "${removedFlow.name}" eliminado.`
      });
      runtimeStore.persistStateToDisk();
      void deleteFlowFromDb(removedFlow.id);
      return { success: true };
    }
  );
}
