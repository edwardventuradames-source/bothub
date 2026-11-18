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

const MAX_GRAPH_STEPS_PER_TURN = 15;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NATIONAL_ID_REGEX = /^\d{6,12}$/;
const DATE_REGEX = /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})$/;

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
  preferredHandle?: string | null
): string | null {
  if (preferredHandle) {
    const matchedByHandle = edges.find(
      (edge) => edge.source === sourceNodeId && edge.sourceHandle === preferredHandle
    );
    if (matchedByHandle) {
      return matchedByHandle.target;
    }
  }
  const defaultEdge = edges.find((edge) => edge.source === sourceNodeId);
  return defaultEdge ? defaultEdge.target : null;
}

function resolveInteractiveSelectionHandle(
  node: FlowNode,
  userInput: string
): { handle: string | null; chosenLabel: string } {
  const normalizedInput = userInput.trim().toLowerCase();

  if (node.type === 'BUTTONS') {
    const buttons = Array.isArray(node.data.buttons)
      ? (node.data.buttons as Array<{ id: string; label: string }>)
      : [];
    for (let idx = 0; idx < buttons.length; idx += 1) {
      const btn = buttons[idx];
      const numericIndex = String(idx + 1);
      if (
        normalizedInput === btn.id.toLowerCase() ||
        normalizedInput === numericIndex ||
        normalizedInput === btn.label.toLowerCase() ||
        btn.label.toLowerCase().includes(normalizedInput)
      ) {
        return { handle: btn.id, chosenLabel: btn.label };
      }
    }
  }

  if (node.type === 'LIST') {
    const items = Array.isArray(node.data.items)
      ? (node.data.items as Array<{ id: string; title: string }>)
      : [];
    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx];
      const numericIndex = String(idx + 1);
      if (
        normalizedInput === item.id.toLowerCase() ||
        normalizedInput === numericIndex ||
        normalizedInput === item.title.toLowerCase() ||
        item.title.toLowerCase().includes(normalizedInput)
      ) {
        return { handle: item.id, chosenLabel: item.title };
      }
    }
  }

  return { handle: null, chosenLabel: userInput.trim() };
}

export function executeFlowSimulationStep(
  nodes: FlowNode[],
  edges: FlowEdge[],
  request: FlowSimulationRequest
): FlowSimulationResponse {
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
      variables.ultima_opcion = selection.chosenLabel;
      trace.push({
        nodeId: pendingNode.id,
        nodeType: pendingNode.type,
        title: String(pendingNode.data.title || 'Selección Interactiva'),
        detail: `Opción seleccionada: "${selection.chosenLabel}"`,
        timestamp: new Date().toISOString()
      });
      const nextTargetId = findNextNodeId(edges, pendingNode.id, selection.handle);
      activeNode = findNode(nextTargetId);
    }
  }

  if (!activeNode) {
    if (request.currentNodeId) {
      activeNode = findNode(request.currentNodeId);
    } else {
      const triggerNode =
        nodes.find((n) => n.type === 'TRIGGER') ?? nodes[0];
      if (triggerNode) {
        trace.push({
          nodeId: triggerNode.id,
          nodeType: triggerNode.type,
          title: String(triggerNode.data.title || 'Disparador'),
          detail: `Activado con mensaje "${request.inputMessage}"`,
          timestamp: new Date().toISOString()
        });
        const afterTriggerId =
          triggerNode.type === 'TRIGGER'
            ? findNextNodeId(edges, triggerNode.id)
            : triggerNode.id;
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
        activeNode = findNode(findNextNodeId(edges, activeNode.id, branchHandle));
        break;
      }

      case 'DELAY': {
        const delaySeconds = Number(activeNode.data.delaySeconds ?? 1);
        trace.push({
          nodeId: activeNode.id,
          nodeType: 'DELAY',
          title: nodeTitle,
          detail: `Indicador "escribiendo..." durante ${delaySeconds}s`,
          timestamp: new Date().toISOString()
        });
        activeNode = findNode(findNextNodeId(edges, activeNode.id));
        break;
      }

      case 'HTTP_REQUEST': {
        const rawUrl = String(activeNode.data.url || 'https://api.bothub.local/v1/lookup');
        const renderedUrl = interpolateFlowVariables(rawUrl, variables);
        const responseVar = String(activeNode.data.responseVariable || 'http_response');
        const simulatedResult = `ORD-${(variables.cedula || '9941').slice(-4)} · En reparto activo (Verificado)`;
        variables[responseVar] = simulatedResult;

        replies.push({
          id: `reply-${crypto.randomUUID().slice(0, 8)}`,
          text: `📦 Consulta externa completada: *${simulatedResult}*`
        });
        trace.push({
          nodeId: activeNode.id,
          nodeType: 'HTTP_REQUEST',
          title: nodeTitle,
          detail: `${String(activeNode.data.method || 'GET')} ${renderedUrl} -> Guardado en {{${responseVar}}}`,
          timestamp: new Date().toISOString()
        });
        activeNode = findNode(findNextNodeId(edges, activeNode.id));
        break;
      }

      case 'AI_PROMPT': {
        const saveVar = String(activeNode.data.saveToVariable || 'respuesta_ia');
        const aiText = `🤖 *Asistente IA BotHub*: Hola ${variables.nombre}, según tu documento ${variables.cedula || 'registrado'} te recomendamos el **Plan Enterprise Multi-Sesión** con integración nativa a Chatwoot y cifrado AES-256-GCM.`;
        variables[saveVar] = aiText;
        replies.push({
          id: `reply-${crypto.randomUUID().slice(0, 8)}`,
          text: aiText
        });
        trace.push({
          nodeId: activeNode.id,
          nodeType: 'AI_PROMPT',
          title: nodeTitle,
          detail: `Respuesta generada con modelo ${String(activeNode.data.model || 'gpt-4o-mini')}`,
          timestamp: new Date().toISOString()
        });
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
