import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import {
  CreateFlowInputSchema,
  FlowDto,
  FlowSimulationRequestSchema,
  SaveFlowGraphInputSchema,
  TestFlowAiNodeInputSchema,
  TestFlowHttpNodeInputSchema,
  UpdateFlowInputSchema
} from '@bothub/shared';
import { DEFAULT_ORG_ID, runtimeStore } from '../../lib/runtime-store.js';
import { deleteFlowFromDb, syncBotRecordToDb, syncFlowToDb } from '../../lib/persistence.js';
import { executeAiPromptNode, executeHttpRequestNode } from './flow.actions.js';
import { executeFlowSimulationStep } from './flow.engine.js';

function applyFlowBotAssignment(
  flow: FlowDto,
  targetBotId: string | null,
  orgId: string
): { ok: true } | { ok: false; error: string; message: string } {
  const matchedBot = targetBotId
    ? runtimeStore.bots.find(
        (b) => b.id === targetBotId && b.organizationId === orgId
      ) ?? null
    : null;
  if (targetBotId && !matchedBot) {
    return {
      ok: false,
      error: 'BOT_NOT_FOUND',
      message: 'El bot especificado no pertenece a tu organización.'
    };
  }

  const previousBotId = flow.botId;
  if (previousBotId && previousBotId !== (matchedBot?.id ?? null)) {
    const previousBot = runtimeStore.bots.find(
      (b) => b.id === previousBotId && b.organizationId === orgId
    );
    if (previousBot && previousBot.activeFlowId === flow.id) {
      previousBot.activeFlowId = null;
      previousBot.activeFlowName = null;
      void syncBotRecordToDb(previousBot);
    }
  }

  flow.botId = matchedBot ? matchedBot.id : null;
  flow.botName = matchedBot ? matchedBot.name : null;
  if (matchedBot) {
    matchedBot.activeFlowId = flow.id;
    matchedBot.activeFlowName = flow.name;
    void syncBotRecordToDb(matchedBot);
  }
  return { ok: true };
}

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
      let targetBot = null;
      if (data.botId) {
        targetBot =
          runtimeStore.bots.find(
            (b) => b.id === data.botId && b.organizationId === orgId
          ) ?? null;
        if (!targetBot) {
          return reply.status(404).send({
            error: 'BOT_NOT_FOUND',
            message: 'El bot especificado no pertenece a tu organización.'
          });
        }
      }

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

      if (data.botId !== undefined) {
        const assignment = applyFlowBotAssignment(flow, data.botId, orgId);
        if (!assignment.ok) {
          return reply.status(404).send({
            error: assignment.error,
            message: assignment.message
          });
        }
      }

      if (data.name !== undefined) flow.name = data.name;
      if (data.description !== undefined) flow.description = data.description;
      if (flow.botId) {
        const linkedBot = runtimeStore.bots.find(
          (b) => b.id === flow.botId && b.organizationId === orgId
        );
        if (linkedBot && linkedBot.activeFlowId === flow.id) {
          linkedBot.activeFlowName = flow.name;
          void syncBotRecordToDb(linkedBot);
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
      runtimeStore.persistStateToDisk();
      void syncFlowToDb(flow);

      return { flow };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Flows'],
        summary: 'Actualizar metadatos o cambiar el bot asignado de un flujo'
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

      const parsed = UpdateFlowInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Datos inválidos para actualizar el flujo.',
          details: parsed.error.flatten()
        });
      }

      const data = parsed.data;
      if (data.botId !== undefined) {
        const assignment = applyFlowBotAssignment(flow, data.botId, orgId);
        if (!assignment.ok) {
          return reply.status(404).send({
            error: assignment.error,
            message: assignment.message
          });
        }
      }

      if (data.name !== undefined) flow.name = data.name;
      if (data.description !== undefined) flow.description = data.description;
      if (data.isMainMenu !== undefined) flow.isMainMenu = data.isMainMenu;

      flow.updatedAt = new Date().toISOString();
      for (const bot of runtimeStore.bots) {
        if (bot.organizationId === orgId && bot.activeFlowId === flow.id) {
          bot.activeFlowName = flow.name;
          void syncBotRecordToDb(bot);
        }
      }

      runtimeStore.appendLog({
        organizationId: orgId,
        botId: flow.botId,
        level: 'INFO',
        event: 'flow.updated',
        message: flow.botName
          ? `Flujo "${flow.name}" asignado al bot "${flow.botName}".`
          : `Flujo "${flow.name}" actualizado (sin bot asignado).`
      });
      runtimeStore.persistStateToDisk();
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
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
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

      const simNodes =
        Array.isArray(parsed.data.nodes) && parsed.data.nodes.length > 0
          ? parsed.data.nodes
          : flow.draftVersion.nodes;
      const simEdges =
        Array.isArray(parsed.data.edges) && parsed.data.nodes
          ? parsed.data.edges
          : flow.draftVersion.edges;

      const result = await executeFlowSimulationStep(
        simNodes,
        simEdges,
        parsed.data,
        { organizationId: orgId }
      );

      return result;
    }
  );

  app.post<{ Params: { id: string } }>(
    '/:id/test-http',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Flows'],
        summary: 'Probar un nodo HTTP_REQUEST del flujo y devolver estado, envío y respuesta'
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

      const parsed = TestFlowHttpNodeInputSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.node.type !== 'HTTP_REQUEST') {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'El nodo enviado debe ser de tipo HTTP_REQUEST con estructura válida.'
        });
      }

      const httpResult = await executeHttpRequestNode(
        parsed.data.node,
        parsed.data.variables
      );

      return {
        ok: httpResult.ok,
        httpDetails: httpResult.httpDetails
      };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/:id/test-ai',
    {
      preHandler: [app.requireRole(['ADMIN', 'OPERATOR'])],
      schema: {
        tags: ['Flows'],
        summary: 'Probar un nodo AI_PROMPT con las credenciales de IA configuradas'
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

      const parsed = TestFlowAiNodeInputSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.node.type !== 'AI_PROMPT') {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'El nodo enviado debe ser de tipo AI_PROMPT con estructura válida.'
        });
      }

      return executeAiPromptNode(
        parsed.data.node,
        parsed.data.variables,
        parsed.data.inputMessage,
        orgId
      );
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
