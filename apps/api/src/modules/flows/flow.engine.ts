import crypto from 'node:crypto';
import {
  FlowDto,
  FlowEdge,
  FlowExecutionStepLog,
  FlowNode,
  FlowSimulationBotReply,
  FlowSimulationRequest,
  FlowSimulationResponse,
  FlowVersionDto,
  QuestionValidationType
} from '@bothub/shared';
import { executeAiPromptNode, executeHttpRequestNode } from './flow.actions.js';

const MAX_GRAPH_STEPS_PER_TURN = 15;
const MAX_DELAY_SECONDS = 15;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NATIONAL_ID_REGEX = /^\d{6,12}$/;
const DATE_REGEX = /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})$/;
const NUMERIC_PREFIX_REGEX = /^\d+[.)\-\s]+/;

export interface FlowExecutionOptions {
  isLiveExecution?: boolean;
  onTyping?: (delayMs: number) => Promise<void>;
}

export function resolveActiveFlowGraph(flow: FlowDto): FlowVersionDto {
  return flow.publishedVersion ?? flow.draftVersion;
}

export function interpolateFlowVariables(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, varName: string) => {
    const value = variables[varName];
    return typeof value === 'string' && value.length > 0 ? value : `{{${varName}}}`;
  });
}

export function validateQuestionAnswer(
  rawInput: string,
  validationType: QuestionValidationType
): { valid: boolean; normalizedValue: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, normalizedValue: '' };
  }

  switch (validationType) {
    case 'NUMBER': {
      const parsed = Number(trimmed.replace(/,/g, '.'));
      return {
        valid: Number.isFinite(parsed),
        normalizedValue: Number.isFinite(parsed) ? String(parsed) : trimmed
      };
    }
    case 'EMAIL':
      return {
        valid: EMAIL_REGEX.test(trimmed),
        normalizedValue: trimmed.toLowerCase()
      };
    case 'NATIONAL_ID': {
      const digitsOnly = trimmed.replace(/[\s.-]/g, '');
      return {
        valid: NATIONAL_ID_REGEX.test(digitsOnly),
        normalizedValue: digitsOnly
      };
    }
    case 'DATE':
      return {
        valid: DATE_REGEX.test(trimmed),
        normalizedValue: trimmed
      };
    case 'TEXT':
    default:
      return {
        valid: trimmed.length >= 1,
        normalizedValue: trimmed
      };
  }
}

function evaluateConditionNode(
  node: FlowNode,
  variables: Record<string, string>,
  latestInput: string
): boolean {
  const variableName = String(node.data.variableName ?? 'ultimo_mensaje');
  const operator = String(node.data.operator ?? 'CONTAINS').toUpperCase();
  const compareValue = String(node.data.compareValue ?? '').trim().toLowerCase();
  const candidateRaw = (variables[variableName] ?? latestInput ?? '').trim();
  const candidateLower = candidateRaw.toLowerCase();

  switch (operator) {
    case 'EQUALS':
      return candidateLower === compareValue;
    case 'NOT_EMPTY':
      return candidateRaw.length > 0;
    case 'GREATER_THAN':
      return Number(candidateRaw) > Number(compareValue);
    case 'REGEX':
      try {
        return new RegExp(String(node.data.compareValue ?? ''), 'i').test(candidateRaw);
      } catch {
        return false;
      }
    case 'CONTAINS':
    default:
      return candidateLower.includes(compareValue);
  }
}

function findNextNodeId(
  edges: FlowEdge[],
  sourceNodeId: string,
  preferredHandle?: string | null,
  strictHandleMatch = false
): string | null {
  if (preferredHandle) {
    const matchedByHandle = edges.find(
      (edge) => edge.source === sourceNodeId && edge.sourceHandle === preferredHandle
    );
    if (matchedByHandle) {
      return matchedByHandle.target;
    }
    if (strictHandleMatch) {
      const neutralEdge = edges.find(
        (edge) => edge.source === sourceNodeId && !edge.sourceHandle
      );
      return neutralEdge ? neutralEdge.target : null;
    }
  }
  const defaultEdge = edges.find((edge) => edge.source === sourceNodeId);
  return defaultEdge ? defaultEdge.target : null;
}

function matchesInteractiveOption(
  optionId: string,
  optionLabel: string,
  index: number,
  normalizedInput: string
): boolean {
  const labelLower = optionLabel.trim().toLowerCase();
  const labelWithoutPrefix = labelLower.replace(NUMERIC_PREFIX_REGEX, '').trim();
  const numericIndex = String(index + 1);

  return (
    normalizedInput === optionId.trim().toLowerCase() ||
    normalizedInput === numericIndex ||
    normalizedInput === labelLower ||
    (labelWithoutPrefix.length > 0 && normalizedInput === labelWithoutPrefix)
  );
}

export function resolveInteractiveSelectionHandle(
  node: FlowNode,
  userInput: string
): { matched: boolean; handle: string | null; chosenLabel: string } {
  const normalizedInput = userInput.trim().toLowerCase();
  if (!normalizedInput) {
    return { matched: false, handle: null, chosenLabel: '' };
  }

  if (node.type === 'BUTTONS') {
    const buttons = Array.isArray(node.data.buttons)
      ? (node.data.buttons as Array<{ id: string; label: string }>)
      : [];
    for (let idx = 0; idx < buttons.length; idx += 1) {
      const btn = buttons[idx];
      if (matchesInteractiveOption(btn.id, btn.label, idx, normalizedInput)) {
        return { matched: true, handle: btn.id, chosenLabel: btn.label };
      }
    }
    return { matched: false, handle: null, chosenLabel: userInput.trim() };
  }

  if (node.type === 'LIST') {
    const items = Array.isArray(node.data.items)
      ? (node.data.items as Array<{ id: string; title: string }>)
      : [];
    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx];
      if (matchesInteractiveOption(item.id, item.title, idx, normalizedInput)) {
        return { matched: true, handle: item.id, chosenLabel: item.title };
      }
    }
    return { matched: false, handle: null, chosenLabel: userInput.trim() };
  }

  return { matched: false, handle: null, chosenLabel: userInput.trim() };
}

function evaluateTriggerMatch(node: FlowNode, inputMessage: string): boolean {
  const matchMode = String(node.data.matchMode ?? 'FIRST_MESSAGE').toUpperCase();
  if (matchMode === 'FIRST_MESSAGE' || matchMode === 'MAIN_MENU' || matchMode === 'OUT_OF_HOURS') {
    return true;
  }

  const rawKeywords = String(node.data.keyword ?? '').trim();
  if (!rawKeywords) {
    return true;
  }

  const normalizedInput = inputMessage.trim().toLowerCase();
  const candidates = rawKeywords
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (candidates.length === 0) {
    return true;
  }

  switch (matchMode) {
    case 'EXACT':
      return candidates.some((kw) => normalizedInput === kw.toLowerCase());
    case 'REGEX':
      return candidates.some((pattern) => {
        try {
          return new RegExp(pattern, 'i').test(inputMessage.trim());
        } catch {
          return false;
        }
      });
    case 'CONTAINS':
    default:
      return candidates.some((kw) => normalizedInput.includes(kw.toLowerCase()));
  }
}

export async function executeFlowSimulationStep(
  nodes: FlowNode[],
  edges: FlowEdge[],
  request: FlowSimulationRequest,
  options: FlowExecutionOptions = {}
): Promise<FlowSimulationResponse> {
  const variables: Record<string, string> = {
    nombre: 'Cliente Demo',
    telefono: '+57 300 000 0000',
    ...request.variables,
    ultimo_mensaje: request.inputMessage.trim()
  };
  const tags = Array.from(new Set(request.tags));
  const replies: FlowSimulationBotReply[] = [];
  const trace: FlowExecutionStepLog[] = [];
  let handoffRequested = false;
  let handoffSummary: string | null = null;
  let completed = false;
  let awaitingQuestionNodeId: string | null = null;

  const findNode = (id: string | null | undefined): FlowNode | undefined =>
    id ? nodes.find((item) => item.id === id) : undefined;

  let activeNode: FlowNode | undefined;

  if (request.awaitingQuestionNodeId) {
    const pendingNode = findNode(request.awaitingQuestionNodeId);
    if (pendingNode && pendingNode.type === 'QUESTION') {
      const validationType =
        (pendingNode.data.validationType as QuestionValidationType) || 'TEXT';
      const validation = validateQuestionAnswer(request.inputMessage, validationType);
      const variableName = String(pendingNode.data.variableName || 'respuesta');

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
      const matchedTrigger =
        triggerNodes.find((n) => evaluateTriggerMatch(n, request.inputMessage)) ??
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

  while (activeNode && stepsExecuted < MAX_GRAPH_STEPS_PER_TURN) {
    stepsExecuted += 1;
    const nodeTitle = String(activeNode.data.title || activeNode.type);

    switch (activeNode.type) {
      case 'MESSAGE': {
        const rawText = String(activeNode.data.text || '');
        const renderedText = interpolateFlowVariables(rawText, variables);
        replies.push({
          id: `reply-${crypto.randomUUID().slice(0, 8)}`,
          text: renderedText,
          mediaUrl: activeNode.data.mediaUrl
            ? String(activeNode.data.mediaUrl)
            : undefined
        });
        trace.push({
          nodeId: activeNode.id,
          nodeType: 'MESSAGE',
          title: nodeTitle,
          detail: `Mensaje enviado (${renderedText.slice(0, 60)}...)`,
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
        replies.push({
          id: `reply-${crypto.randomUUID().slice(0, 8)}`,
          text: promptText
        });
        trace.push({
          nodeId: activeNode.id,
          nodeType: 'QUESTION',
          title: nodeTitle,
          detail: `Esperando respuesta para {{${String(activeNode.data.variableName || 'respuesta')}}}`,
          timestamp: new Date().toISOString()
        });
        awaitingQuestionNodeId = activeNode.id;
        return {
          replies,
          nextNodeId: activeNode.id,
          awaitingQuestionNodeId,
          variables,
          tags,
          handoffRequested,
          handoffSummary,
          completed,
          trace
        };
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
        return {
          replies,
          nextNodeId: activeNode.id,
          awaitingQuestionNodeId,
          variables,
          tags,
          handoffRequested,
          handoffSummary,
          completed,
          trace
        };
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
        return {
          replies,
          nextNodeId: activeNode.id,
          awaitingQuestionNodeId,
          variables,
          tags,
          handoffRequested,
          handoffSummary,
          completed,
          trace
        };
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
          await new Promise((resolve) => setTimeout(resolve, delayMs));
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
        const responseVar = String(activeNode.data.responseVariable || 'http_response');
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
        const saveVar = String(activeNode.data.saveToVariable || 'respuesta_ia');
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
        for (const tag of nodeTags) {
          if (!tags.includes(tag)) {
            tags.push(tag);
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

  return {
    replies,
    nextNodeId: activeNode ? activeNode.id : null,
    awaitingQuestionNodeId,
    variables,
    tags,
    handoffRequested,
    handoffSummary,
    completed,
    trace
  };
}
