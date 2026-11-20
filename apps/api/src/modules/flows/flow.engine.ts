import crypto from 'node:crypto';
import {
  FlowEdge,
  FlowExecutionStepLog,
  FlowNode,
  FlowSimulationBotReply,
  FlowSimulationRequest,
  FlowSimulationResponse,
  QuestionValidationType
} from '@bothub/shared';
import { executeAiPromptNode, executeHttpRequestNode } from './flow.actions.js';
import {
  evaluateConditionNode,
  evaluateTriggerMatch,
  findNextNodeId,
  inferFlowMediaType,
  interpolateFlowVariables,
  resolveActiveFlowGraph,
  resolveInteractiveSelectionHandle,
  sanitizeVariableName,
  validateQuestionAnswer
} from './flow-evaluators.js';

export {
  evaluateConditionNode,
  evaluateTriggerMatch,
  findNextNodeId,
  inferFlowMediaType,
  interpolateFlowVariables,
  resolveActiveFlowGraph,
  resolveInteractiveSelectionHandle,
  validateQuestionAnswer
};

const MAX_GRAPH_STEPS_PER_TURN = 15;
const MAX_DELAY_SECONDS = 15;
const MAX_LIVE_DELAY_MS = 2500;

export interface FlowExecutionOptions {
  isLiveExecution?: boolean;
  onTyping?: (delayMs: number) => Promise<void>;
}

export async function executeFlowSimulationStep(
  nodes: FlowNode[],
  edges: FlowEdge[],
  request: FlowSimulationRequest,
  options: FlowExecutionOptions = {}
): Promise<FlowSimulationResponse> {
  const defaultVariables: Record<string, string> = options.isLiveExecution
    ? {}
    : {
        nombre: 'Cliente Demo',
        telefono: '+57 300 000 0000'
      };
  const variables: Record<string, string> = {
    ...defaultVariables,
    ...request.variables,
    ultimo_mensaje: request.inputMessage.trim()
  };
  const tags = Array.from(new Set(request.tags));
  const assignedTags: string[] = [];
  const replies: FlowSimulationBotReply[] = [];
  const trace: FlowExecutionStepLog[] = [];
  let handoffRequested = false;
  let handoffSummary: string | null = null;
  let completed = false;
  let awaitingQuestionNodeId: string | null = null;

  const buildResult = (nextNodeId: string | null): FlowSimulationResponse => ({
    replies,
    nextNodeId,
    awaitingQuestionNodeId,
    variables,
    tags,
    assignedTags,
    handoffRequested,
    handoffSummary,
    completed,
    trace
  });

  const findNode = (id: string | null | undefined): FlowNode | undefined =>
    id ? nodes.find((item) => item.id === id) : undefined;

  let activeNode: FlowNode | undefined;

  if (request.awaitingQuestionNodeId) {
    const pendingNode = findNode(request.awaitingQuestionNodeId);
    if (pendingNode && pendingNode.type === 'QUESTION') {
      const validationType =
        (pendingNode.data.validationType as QuestionValidationType) || 'TEXT';
      const validation = validateQuestionAnswer(request.inputMessage, validationType);
      const variableName =
        String(pendingNode.data.variableName || 'respuesta').replace(/[{}\s]/g, '') ||
        'respuesta';

      if (!validation.valid) {
        const errorText = interpolateFlowVariables(
          String(
            pendingNode.data.errorMessage ||
              'Formato inválido. Por favor verifica tu respuesta e inténtalo de nuevo.'
          ),
          variables
        );
        replies.push({
          id: `reply-${crypto.randomUUID().slice(0, 8)}`,
          text: `⚠️ ${errorText}`
        });
        trace.push({
          nodeId: pendingNode.id,
          nodeType: 'QUESTION',
          title: String(pendingNode.data.title || 'Pregunta'),
          detail: `Validación fallida (${validationType}) para entrada "${request.inputMessage}"`,
          timestamp: new Date().toISOString()
        });
        return {
          replies,
          nextNodeId: pendingNode.id,
          awaitingQuestionNodeId: pendingNode.id,
          variables,
          tags,
          handoffRequested: false,
          handoffSummary: null,
          completed: false,
          trace
        };
      }

      variables[variableName] = validation.normalizedValue;
      trace.push({
        nodeId: pendingNode.id,
        nodeType: 'QUESTION',
        title: String(pendingNode.data.title || 'Pregunta'),
        detail: `Variable {{${variableName}}} = "${validation.normalizedValue}" (${validationType} OK)`,
        timestamp: new Date().toISOString()
      });
      const nextTargetId = findNextNodeId(edges, pendingNode.id);
      activeNode = findNode(nextTargetId);
    } else if (
      pendingNode &&
      (pendingNode.type === 'BUTTONS' || pendingNode.type === 'LIST')
    ) {
      const selection = resolveInteractiveSelectionHandle(
        pendingNode,
        request.inputMessage
      );

      if (!selection.matched) {
        const retryButtons =
          pendingNode.type === 'BUTTONS' && Array.isArray(pendingNode.data.buttons)
            ? (pendingNode.data.buttons as Array<{ id: string; label: string }>)
            : undefined;
        const retryItems =
          pendingNode.type === 'LIST' && Array.isArray(pendingNode.data.items)
            ? (pendingNode.data.items as Array<{
                id: string;
                title: string;
                description?: string;
              }>)
            : undefined;

        replies.push({
          id: `reply-${crypto.randomUUID().slice(0, 8)}`,
          text: '⚠️ Opción no reconocida. Por favor selecciona una de las opciones disponibles:',
          buttons: retryButtons,
          listItems: retryItems
        });
        trace.push({
          nodeId: pendingNode.id,
          nodeType: pendingNode.type,
          title: String(pendingNode.data.title || 'Selección Interactiva'),
          detail: `Opción inválida "${request.inputMessage}". Solicitando reintento.`,
          timestamp: new Date().toISOString()
        });
        return {
          replies,
          nextNodeId: pendingNode.id,
          awaitingQuestionNodeId: pendingNode.id,
          variables,
          tags,
          handoffRequested: false,
          handoffSummary: null,
          completed: false,
          trace
        };
      }

      variables.ultima_opcion = selection.chosenLabel;
      trace.push({
        nodeId: pendingNode.id,
        nodeType: pendingNode.type,
        title: String(pendingNode.data.title || 'Selección Interactiva'),
        detail: `Opción seleccionada: "${selection.chosenLabel}"`,
        timestamp: new Date().toISOString()
      });
      const nextTargetId = findNextNodeId(edges, pendingNode.id, selection.handle, true);
      activeNode = findNode(nextTargetId);
    }
  }

  if (!activeNode && !request.awaitingQuestionNodeId) {
    if (request.currentNodeId) {
      activeNode = findNode(request.currentNodeId);
    } else {
      const triggerNodes = nodes.filter((n) => n.type === 'TRIGGER');
      const specificTriggers = triggerNodes.filter((n) => {
        const mode = String(n.data.matchMode ?? 'FIRST_MESSAGE').toUpperCase();
        return mode === 'EXACT' || mode === 'CONTAINS' || mode === 'REGEX';
      });
      const fallbackTriggers = triggerNodes.filter((n) => {
        const mode = String(n.data.matchMode ?? 'FIRST_MESSAGE').toUpperCase();
        return mode !== 'EXACT' && mode !== 'CONTAINS' && mode !== 'REGEX';
      });
      const matchedTrigger =
        specificTriggers.find((n) => evaluateTriggerMatch(n, request.inputMessage)) ??
        fallbackTriggers.find((n) => evaluateTriggerMatch(n, request.inputMessage)) ??
        triggerNodes[0] ??
        nodes[0];

      if (matchedTrigger) {
        trace.push({
          nodeId: matchedTrigger.id,
          nodeType: matchedTrigger.type,
          title: String(matchedTrigger.data.title || 'Disparador'),
          detail: `Activado con mensaje "${request.inputMessage}"`,
          timestamp: new Date().toISOString()
        });
        const afterTriggerId =
          matchedTrigger.type === 'TRIGGER'
            ? findNextNodeId(edges, matchedTrigger.id)
            : matchedTrigger.id;
        activeNode = findNode(afterTriggerId);
      }
    }
  }

  let stepsExecuted = 0;
  const visitedNodeIds = new Set<string>();

  while (activeNode && stepsExecuted < MAX_GRAPH_STEPS_PER_TURN) {
    if (visitedNodeIds.has(activeNode.id)) {
      trace.push({
        nodeId: activeNode.id,
        nodeType: activeNode.type,
        title: String(activeNode.data.title || activeNode.type),
        detail: 'Ejecución detenida para evitar ciclo infinito en el grafo.',
        timestamp: new Date().toISOString()
      });
      activeNode = undefined;
      break;
    }
    visitedNodeIds.add(activeNode.id);
    stepsExecuted += 1;
    const nodeTitle = String(activeNode.data.title || activeNode.type);

    switch (activeNode.type) {
      case 'MESSAGE': {
        const rawText = String(activeNode.data.text || '');
        const renderedText = interpolateFlowVariables(rawText, variables);
        const rawMediaUrl =
          typeof activeNode.data.mediaUrl === 'string'
            ? activeNode.data.mediaUrl.trim()
            : '';
        const renderedMediaUrl = rawMediaUrl
          ? interpolateFlowVariables(rawMediaUrl, variables).trim()
          : '';
        const hasValidMediaUrl = /^https?:\/\/.+/i.test(renderedMediaUrl);
        replies.push({
          id: `reply-${crypto.randomUUID().slice(0, 8)}`,
          text: renderedText,
          mediaUrl: hasValidMediaUrl ? renderedMediaUrl : undefined,
          mediaType: hasValidMediaUrl ? inferFlowMediaType(renderedMediaUrl) : undefined
        });
        trace.push({
          nodeId: activeNode.id,
          nodeType: 'MESSAGE',
          title: nodeTitle,
          detail: hasValidMediaUrl
            ? `Mensaje con multimedia enviada (${renderedText.slice(0, 45)}...)`
            : `Mensaje enviado (${renderedText.slice(0, 60)}...)`,
          timestamp: new Date().toISOString()
        });
        activeNode = findNode(findNextNodeId(edges, activeNode.id));
        break;
      }

      case 'QUESTION': {
        const promptText = interpolateFlowVariables(
          String(activeNode.data.promptText || 'Por favor escribe tu respuesta:'),
          variables
        );
        const questionVarName =
          String(activeNode.data.variableName || 'respuesta').replace(/[{}\s]/g, '') ||
          'respuesta';
        replies.push({
          id: `reply-${crypto.randomUUID().slice(0, 8)}`,
          text: promptText
        });
        trace.push({
          nodeId: activeNode.id,
          nodeType: 'QUESTION',
          title: nodeTitle,
          detail: `Esperando respuesta para {{${questionVarName}}}`,
          timestamp: new Date().toISOString()
        });
        awaitingQuestionNodeId = activeNode.id;
        return buildResult(activeNode.id);
      }

      case 'BUTTONS': {
        const bodyText = interpolateFlowVariables(
          String(activeNode.data.bodyText || 'Selecciona una opción:'),
          variables
        );
        const buttons = Array.isArray(activeNode.data.buttons)
          ? (activeNode.data.buttons as Array<{ id: string; label: string }>)
          : [];
        replies.push({
          id: `reply-${crypto.randomUUID().slice(0, 8)}`,
          text: bodyText,
          buttons
        });
        trace.push({
          nodeId: activeNode.id,
          nodeType: 'BUTTONS',
          title: nodeTitle,
          detail: `Mostrando ${buttons.length} botones interactivos`,
          timestamp: new Date().toISOString()
        });
        awaitingQuestionNodeId = activeNode.id;
        return buildResult(activeNode.id);
      }

      case 'LIST': {
        const bodyText = interpolateFlowVariables(
          String(activeNode.data.bodyText || 'Selecciona un elemento de la lista:'),
          variables
        );
        const listItems = Array.isArray(activeNode.data.items)
          ? (activeNode.data.items as Array<{
              id: string;
              title: string;
              description?: string;
            }>)
          : [];
        replies.push({
          id: `reply-${crypto.randomUUID().slice(0, 8)}`,
          text: bodyText,
          listItems
        });
        trace.push({
          nodeId: activeNode.id,
          nodeType: 'LIST',
          title: nodeTitle,
          detail: `Mostrando lista desplegable con ${listItems.length} opciones`,
          timestamp: new Date().toISOString()
        });
        awaitingQuestionNodeId = activeNode.id;
        return buildResult(activeNode.id);
      }

      case 'CONDITION': {
        const matched = evaluateConditionNode(
          activeNode,
          variables,
          request.inputMessage
        );
        const branchHandle = matched ? 'true' : 'false';
        trace.push({
          nodeId: activeNode.id,
          nodeType: 'CONDITION',
          title: nodeTitle,
          detail: `Evaluación condicional -> ${matched ? 'VERDADERO (true)' : 'FALSO (false)'}`,
          timestamp: new Date().toISOString()
        });
        activeNode = findNode(findNextNodeId(edges, activeNode.id, branchHandle, true));
        break;
      }

      case 'DELAY': {
        const rawDelay = Number(activeNode.data.delaySeconds ?? 1);
        const boundedSeconds = Number.isFinite(rawDelay)
          ? Math.min(Math.max(rawDelay, 0), MAX_DELAY_SECONDS)
          : 1;
        const delayMs = Math.round(boundedSeconds * 1000);

        if (options.isLiveExecution && delayMs > 0) {
          if (options.onTyping) {
            await options.onTyping(delayMs);
          }
          const boundedLiveWait = Math.min(delayMs, MAX_LIVE_DELAY_MS);
          await new Promise((resolve) => setTimeout(resolve, boundedLiveWait));
        }

        trace.push({
          nodeId: activeNode.id,
          nodeType: 'DELAY',
          title: nodeTitle,
          detail: `Indicador "escribiendo..." durante ${boundedSeconds}s`,
          timestamp: new Date().toISOString()
        });
        activeNode = findNode(findNextNodeId(edges, activeNode.id));
        break;
      }

      case 'HTTP_REQUEST': {
        const responseVar = sanitizeVariableName(
          activeNode.data.responseVariable,
          'http_response'
        );
        const httpResult = await executeHttpRequestNode(activeNode, variables);

        if (httpResult.ok) {
          variables[responseVar] = httpResult.value;
          delete variables[`${responseVar}_error`];
          trace.push({
            nodeId: activeNode.id,
            nodeType: 'HTTP_REQUEST',
            title: nodeTitle,
            detail: `${httpResult.method} ${httpResult.renderedUrl} (${httpResult.statusCode}) -> {{${responseVar}}}`,
            timestamp: new Date().toISOString()
          });
        } else {
          variables[`${responseVar}_error`] = httpResult.errorMessage ?? 'Error HTTP';
          trace.push({
            nodeId: activeNode.id,
            nodeType: 'HTTP_REQUEST',
            title: nodeTitle,
            detail: `Error ${httpResult.method} ${httpResult.renderedUrl}: ${httpResult.errorMessage}`,
            timestamp: new Date().toISOString()
          });
        }

        activeNode = findNode(findNextNodeId(edges, activeNode.id));
        break;
      }

      case 'AI_PROMPT': {
        const saveVar = sanitizeVariableName(
          activeNode.data.saveToVariable,
          'respuesta_ia'
        );
        const aiResult = await executeAiPromptNode(
          activeNode,
          variables,
          request.inputMessage
        );

        if (aiResult.ok) {
          variables[saveVar] = aiResult.text;
          delete variables[`${saveVar}_error`];
          replies.push({
            id: `reply-${crypto.randomUUID().slice(0, 8)}`,
            text: aiResult.text
          });
          trace.push({
            nodeId: activeNode.id,
            nodeType: 'AI_PROMPT',
            title: nodeTitle,
            detail: `Respuesta generada con ${aiResult.model} -> {{${saveVar}}}`,
            timestamp: new Date().toISOString()
          });
        } else {
          variables[`${saveVar}_error`] = aiResult.errorMessage ?? 'Error IA';
          const fallbackText =
            typeof activeNode.data.fallbackMessage === 'string' &&
            activeNode.data.fallbackMessage.trim().length > 0
              ? interpolateFlowVariables(activeNode.data.fallbackMessage, variables)
              : null;
          if (fallbackText) {
            replies.push({
              id: `reply-${crypto.randomUUID().slice(0, 8)}`,
              text: fallbackText
            });
          }
          trace.push({
            nodeId: activeNode.id,
            nodeType: 'AI_PROMPT',
            title: nodeTitle,
            detail: `Error IA (${aiResult.model}): ${aiResult.errorMessage}`,
            timestamp: new Date().toISOString()
          });
        }

        activeNode = findNode(findNextNodeId(edges, activeNode.id));
        break;
      }

      case 'ASSIGN_TAG': {
        const nodeTags = Array.isArray(activeNode.data.tags)
          ? (activeNode.data.tags as string[])
          : [];
        for (const rawTag of nodeTags) {
          const tag = rawTag.trim();
          if (!tag) continue;
          if (!tags.includes(tag)) {
            tags.push(tag);
          }
          if (!assignedTags.includes(tag)) {
            assignedTags.push(tag);
          }
        }
        trace.push({
          nodeId: activeNode.id,
          nodeType: 'ASSIGN_TAG',
          title: nodeTitle,
          detail: `Etiquetas sincronizadas: ${nodeTags.join(', ')}`,
          timestamp: new Date().toISOString()
        });
        activeNode = findNode(findNextNodeId(edges, activeNode.id));
        break;
      }

      case 'HANDOFF': {
        const clientMessage = interpolateFlowVariables(
          String(
            activeNode.data.clientMessage ||
              'Te estamos transfiriendo con un agente humano en Chatwoot.'
          ),
          variables
        );
        const privateNote = interpolateFlowVariables(
          String(
            activeNode.data.privateNoteTemplate ||
              'Resumen Handoff: Cliente {{nombre}} ({{telefono}}).'
          ),
          variables
        );
        replies.push({
          id: `reply-${crypto.randomUUID().slice(0, 8)}`,
          text: `👨‍💼 ${clientMessage}`
        });
        handoffRequested = true;
        handoffSummary = privateNote;
        completed = true;
        trace.push({
          nodeId: activeNode.id,
          nodeType: 'HANDOFF',
          title: nodeTitle,
          detail: `Conversación transferida a Chatwoot (${String(activeNode.data.teamName || 'Agentes')}). Nota privada: "${privateNote}"`,
          timestamp: new Date().toISOString()
        });
        activeNode = undefined;
        break;
      }

      case 'END': {
        const farewell = interpolateFlowVariables(
          String(activeNode.data.farewellMessage || '¡Gracias por contactarnos!'),
          variables
        );
        replies.push({
          id: `reply-${crypto.randomUUID().slice(0, 8)}`,
          text: farewell
        });
        completed = true;
        trace.push({
          nodeId: activeNode.id,
          nodeType: 'END',
          title: nodeTitle,
          detail: 'Flujo finalizado correctamente',
          timestamp: new Date().toISOString()
        });
        activeNode = undefined;
        break;
      }

      default:
        activeNode = findNode(findNextNodeId(edges, activeNode.id));
        break;
    }
  }

  return buildResult(activeNode ? activeNode.id : null);
}
