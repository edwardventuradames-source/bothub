import { Edge, Node } from '@xyflow/react';
import { FlowEdge, FlowNode, FlowNodeType } from '@bothub/shared';

export interface PaletteNodeOption {
  type: FlowNodeType;
  label: string;
  badgeColor: string;
  defaultData: Record<string, unknown>;
}

export const FLOW_NODE_PALETTE: PaletteNodeOption[] = [
  {
    type: 'TRIGGER',
    label: '1. Disparador',
    badgeColor: '#2152ff',
    defaultData: {
      title: 'Disparador Palabra Clave',
      matchMode: 'CONTAINS',
      keyword: 'hola, menu'
    }
  },
  {
    type: 'MESSAGE',
    label: '2. Mensaje',
    badgeColor: '#0ea5e9',
    defaultData: {
      title: 'Mensaje al Cliente',
      text: 'Hola {{nombre}}, gracias por escribirnos.'
    }
  },
  {
    type: 'QUESTION',
    label: '3. Pregunta + Validación',
    badgeColor: '#8b5cf6',
    defaultData: {
      title: 'Solicitar Dato',
      promptText: 'Por favor ingresa tu número de documento:',
      variableName: 'cedula',
      validationType: 'NATIONAL_ID',
      errorMessage: 'Ingresa un documento válido (6 a 12 dígitos).'
    }
  },
  {
    type: 'BUTTONS',
    label: '4. Botones (Máx 3)',
    badgeColor: '#ec4899',
    defaultData: {
      title: 'Menú de Botones',
      bodyText: 'Selecciona una opción para continuar:',
      buttons: [
        { id: 'btn-1', label: '1. Ventas' },
        { id: 'btn-2', label: '2. Soporte' },
        { id: 'btn-3', label: '3. Asesor' }
      ]
    }
  },
  {
    type: 'LIST',
    label: '5. Lista Desplegable',
    badgeColor: '#6366f1',
    defaultData: {
      title: 'Lista de Opciones',
      bodyText: 'Elige una categoría del menú desplegable:',
      items: [
        { id: 'item-1', title: '1. Facturación', description: 'Estado de cuenta' },
        { id: 'item-2', title: '2. Soporte Técnico', description: 'Ayuda en línea' }
      ]
    }
  },
  {
    type: 'CONDITION',
    label: '6. Condición (If/Else)',
    badgeColor: '#f59e0b',
    defaultData: {
      title: 'Evaluar Variable',
      variableName: 'cedula',
      operator: 'NOT_EMPTY',
      compareValue: ''
    }
  },
  {
    type: 'HTTP_REQUEST',
    label: '7. Petición HTTP / Webhook',
    badgeColor: '#10b981',
    defaultData: {
      title: 'Consultar API Externa',
      method: 'GET',
      url: 'https://api.example.com/v1/orders?document={{cedula}}',
      responseVariable: 'estado_pedido'
    }
  },
  {
    type: 'AI_PROMPT',
    label: '8. Respuesta con IA',
    badgeColor: '#7928ca',
    defaultData: {
      title: 'Asistente IA Contextual',
      systemPrompt: 'Responde de forma amable usando las variables del cliente.',
      model: 'gpt-4o-mini',
      saveToVariable: 'respuesta_ia'
    }
  },
  {
    type: 'ASSIGN_TAG',
    label: '9. Etiqueta Chatwoot',
    badgeColor: '#14b8a6',
    defaultData: {
      title: 'Asignar Etiquetas',
      tags: ['lead-calificado', 'whatsapp']
    }
  },
  {
    type: 'DELAY',
    label: '10. Espera / Escribiendo',
    badgeColor: '#64748b',
    defaultData: {
      title: 'Pausa Escribiendo...',
      delaySeconds: 2
    }
  },
  {
    type: 'HANDOFF',
    label: '11. Transferir a Chatwoot',
    badgeColor: '#ef4444',
    defaultData: {
      title: 'Handoff a Agente Humano',
      teamName: 'Ventas & Soporte',
      clientMessage: 'Te estamos transfiriendo con un especialista en Chatwoot.',
      privateNoteTemplate: 'Handoff para {{nombre}} (Cédula: {{cedula}}).'
    }
  },
  {
    type: 'END',
    label: '12. Fin de Flujo',
    badgeColor: '#334155',
    defaultData: {
      title: 'Cerrar Conversación',
      farewellMessage: '¡Gracias por comunicarte con nosotros!'
    }
  }
];

export function getFlowNodeAccentColor(nodeType: FlowNodeType): string {
  const paletteItem = FLOW_NODE_PALETTE.find((p) => p.type === nodeType);
  return paletteItem?.badgeColor ?? '#2152ff';
}

export function buildFlowNodeLabel(
  nodeType: FlowNodeType,
  data: Record<string, unknown>
): string {
  const title = String(data.title || nodeType);
  const preview = String(
    data.text ||
      data.promptText ||
      data.bodyText ||
      data.keyword ||
      data.url ||
      data.clientMessage ||
      data.farewellMessage ||
      ''
  ).slice(0, 48);
  return `[${nodeType}] ${title}${preview ? ` — ${preview}` : ''}`;
}

export function mapFlowNodesToReactFlow(
  flowNodes: FlowNode[],
  highlightedNodeId: string | null
): Node[] {
  return flowNodes.map((fn) => {
    const accentColor = getFlowNodeAccentColor(fn.type);
    const isHighlighted = highlightedNodeId === fn.id;

    return {
      id: fn.id,
      position: fn.position,
      data: {
        ...fn.data,
        nodeType: fn.type,
        label: buildFlowNodeLabel(fn.type, fn.data)
      },
      style: {
        borderRadius: '14px',
        border: isHighlighted
          ? '3px solid #82d616'
          : `2px solid ${accentColor}`,
        background: '#ffffff',
        color: '#344767',
        padding: '10px 12px',
        fontSize: '11px',
        fontWeight: 700,
        width: 230,
        boxShadow: isHighlighted
          ? '0 0 0 5px rgba(130, 214, 22, 0.28)'
          : '0 8px 20px rgba(52, 71, 103, 0.08)'
      }
    };
  });
}

export const FLOW_DELETE_KEYS: string[] = ['Backspace', 'Delete'];

export const FLOW_DEFAULT_EDGE_OPTIONS = {
  animated: true,
  interactionWidth: 24,
  style: { stroke: '#2152ff', strokeWidth: 2 }
};

export function mapFlowEdgesToReactFlow(flowEdges: FlowEdge[]): Edge[] {
  return flowEdges.map((fe) => ({
    ...FLOW_DEFAULT_EDGE_OPTIONS,
    id: fe.id,
    source: fe.source,
    target: fe.target,
    sourceHandle: fe.sourceHandle ?? undefined,
    targetHandle: fe.targetHandle ?? undefined,
    label: fe.label
  }));
}
