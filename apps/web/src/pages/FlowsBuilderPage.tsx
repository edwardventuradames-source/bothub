import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Background,
  Connection,
  Controls,
  Edge,
  MiniMap,
  Node,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState
} from '@xyflow/react';
import {
  CheckCircle2,
  GitBranch,
  History,
  Plus,
  Rocket,
  Save
} from 'lucide-react';
import {
  BotDto,
  FlowDto,
  FlowEdge,
  FlowNode,
  FlowNodeType
} from '@bothub/shared';
import { botsApi, flowsApi } from '../lib/api.js';
import { FlowSimulatorPanel } from '../components/flows/FlowSimulatorPanel.js';
import { FlowNodeInspector } from '../components/flows/FlowNodeInspector.js';

interface PaletteNodeOption {
  type: FlowNodeType;
  label: string;
  badgeColor: string;
  defaultData: Record<string, unknown>;
}

const NODE_PALETTE: PaletteNodeOption[] = [
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
      url: 'https://api.bothub.local/v1/orders?document={{cedula}}',
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

function mapFlowNodesToReactFlow(
  flowNodes: FlowNode[],
  highlightedNodeId: string | null
): Node[] {
  return flowNodes.map((fn) => {
    const paletteItem = NODE_PALETTE.find((p) => p.type === fn.type);
    const accentColor = paletteItem?.badgeColor ?? '#2152ff';
    const isHighlighted = highlightedNodeId === fn.id;
    const title = String(fn.data.title || fn.type);
    const preview = String(
      fn.data.text ||
        fn.data.promptText ||
        fn.data.bodyText ||
        fn.data.keyword ||
        fn.data.url ||
        fn.data.clientMessage ||
        fn.data.farewellMessage ||
        ''
    ).slice(0, 48);

    return {
      id: fn.id,
      position: fn.position,
      data: {
        ...fn.data,
        nodeType: fn.type,
        label: `[${fn.type}] ${title}${preview ? ` — ${preview}` : ''}`
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

function mapFlowEdgesToReactFlow(flowEdges: FlowEdge[]): Edge[] {
  return flowEdges.map((fe) => ({
    id: fe.id,
    source: fe.source,
    target: fe.target,
    sourceHandle: fe.sourceHandle ?? undefined,
    targetHandle: fe.targetHandle ?? undefined,
    label: fe.label,
    animated: true,
    style: { stroke: '#2152ff', strokeWidth: 2 }
  }));
}

export function FlowsBuilderPage() {
  const newFlowDialogTitleId = useId();
  const newFlowDialogRef = useRef<HTMLDialogElement | null>(null);

  const [flows, setFlows] = useState<FlowDto[]>([]);
  const [bots, setBots] = useState<BotDto[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [newFlowName, setNewFlowName] = useState('');
  const [newFlowDesc, setNewFlowDesc] = useState('');
  const [newFlowBotId, setNewFlowBotId] = useState('');

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const activeFlow = useMemo(
    () => flows.find((f) => f.id === selectedFlowId) ?? flows[0] ?? null,
    [flows, selectedFlowId]
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  useEffect(() => {
    async function loadInitial(): Promise<void> {
      const [flowsRes, botsRes] = await Promise.all([
        flowsApi.list(),
        botsApi.list()
      ]);
      setFlows(flowsRes.flows);
      setBots(botsRes.bots);
      if (flowsRes.flows[0]) {
        const initialFlow = flowsRes.flows[0];
        setSelectedFlowId(initialFlow.id);
        setNodes(mapFlowNodesToReactFlow(initialFlow.draftVersion.nodes, null));
        setEdges(mapFlowEdgesToReactFlow(initialFlow.draftVersion.edges));
        setSelectedNodeId(initialFlow.draftVersion.nodes[0]?.id ?? null);
      }
    }
    void loadInitial();
  }, [setEdges, setNodes]);

  function handleSelectFlow(flowId: string): void {
    setSelectedFlowId(flowId);
    const target = flows.find((f) => f.id === flowId);
    if (target) {
      setNodes(mapFlowNodesToReactFlow(target.draftVersion.nodes, null));
      setEdges(mapFlowEdgesToReactFlow(target.draftVersion.edges));
      setSelectedNodeId(target.draftVersion.nodes[0]?.id ?? null);
      setHighlightedNodeId(null);
    }
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: `edge-${Date.now()}`,
            animated: true,
            label: 'Continuar',
            style: { stroke: '#2152ff', strokeWidth: 2 }
          },
          eds
        )
      );
    },
    [setEdges]
  );

  function handleAddNodeFromPalette(option: PaletteNodeOption): void {
    const newNodeId = `node-${option.type.toLowerCase()}-${Date.now().toString().slice(-4)}`;
    const offsetCount = nodes.length;
    const newPosition = {
      x: 120 + (offsetCount % 4) * 260,
      y: 100 + Math.floor(offsetCount / 4) * 140
    };

    const nextFlowNode: FlowNode = {
      id: newNodeId,
      type: option.type,
      position: newPosition,
      data: structuredClone(option.defaultData)
    };

    const mappedNode = mapFlowNodesToReactFlow([nextFlowNode], highlightedNodeId)[0];
    setNodes((prev) => [...prev, mappedNode]);

    if (selectedNodeId) {
      setEdges((prev) => [
        ...prev,
        {
          id: `e-${selectedNodeId}-${newNodeId}`,
          source: selectedNodeId,
          target: newNodeId,
          animated: true,
          label: 'Siguiente',
          style: { stroke: '#2152ff', strokeWidth: 2 }
        }
      ]);
    }

    setSelectedNodeId(newNodeId);
    setStatusMessage(`Nodo [${option.type}] añadido al lienzo.`);
  }

  function updateSelectedNodeData(key: string, value: unknown): void {
    if (!selectedNodeId) return;
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== selectedNodeId) {
          return node;
        }
        const nextData = {
          ...node.data,
          [key]: value
        };
        const nodeType = String(nextData.nodeType || 'MESSAGE') as FlowNodeType;
        const title = String(nextData.title || nodeType);
        const preview = String(
          nextData.text ||
            nextData.promptText ||
            nextData.bodyText ||
            nextData.keyword ||
            nextData.url ||
            nextData.clientMessage ||
            nextData.farewellMessage ||
            ''
        ).slice(0, 48);

        return {
          ...node,
          data: {
            ...nextData,
            label: `[${nodeType}] ${title}${preview ? ` — ${preview}` : ''}`
          }
        };
      })
    );
  }

  function handleDeleteSelectedNode(): void {
    if (!selectedNodeId) return;
    setNodes((prev) => prev.filter((n) => n.id !== selectedNodeId));
    setEdges((prev) =>
      prev.filter(
        (e) => e.source !== selectedNodeId && e.target !== selectedNodeId
      )
    );
    setSelectedNodeId(null);
    setStatusMessage('Nodo eliminado del flujo.');
  }

  async function handleSaveOrPublish(publish: boolean): Promise<void> {
    if (!activeFlow) return;
    setIsSaving(true);
    try {
      const serializedNodes: FlowNode[] = nodes.map((n) => {
        const { label: _lbl, nodeType, ...cleanData } = n.data as Record<
          string,
          unknown
        >;
        return {
          id: n.id,
          type: (nodeType as FlowNodeType) || 'MESSAGE',
          position: n.position,
          data: cleanData
        };
      });

      const serializedEdges: FlowEdge[] = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        label: typeof e.label === 'string' ? e.label : undefined
      }));

      const { flow } = await flowsApi.saveGraph(activeFlow.id, {
        name: activeFlow.name,
        description: activeFlow.description,
        botId: activeFlow.botId,
        nodes: serializedNodes,
        edges: serializedEdges,
        publish
      });

      setFlows((prev) => prev.map((f) => (f.id === flow.id ? flow : f)));
      setStatusMessage(
        publish
          ? `✅ Flujo publicado en producción (Versión v${flow.activeVersionNumber}).`
          : `💾 Borrador guardado (${serializedNodes.length} nodos, ${serializedEdges.length} conexiones).`
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateNewFlow(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!newFlowName.trim()) return;

    const { flow } = await flowsApi.create({
      name: newFlowName.trim(),
      description:
        newFlowDesc.trim() ||
        'Flujo conversacional creado desde el Constructor Visual.',
      botId: newFlowBotId || null,
      isMainMenu: true
    });

    setFlows((prev) => [flow, ...prev]);
    setSelectedFlowId(flow.id);
    setNodes(mapFlowNodesToReactFlow(flow.draftVersion.nodes, null));
    setEdges(mapFlowEdgesToReactFlow(flow.draftVersion.edges));
    setSelectedNodeId(flow.draftVersion.nodes[0]?.id ?? null);
    setNewFlowName('');
    setNewFlowDesc('');
    newFlowDialogRef.current?.close();
    setStatusMessage(`Nuevo flujo "${flow.name}" creado y listo para editar.`);
  }

  async function handleRestoreVersion(versionId: string): Promise<void> {
    if (!activeFlow || !versionId) return;
    setIsSaving(true);
    try {
      const { flow } = await flowsApi.restoreVersion(activeFlow.id, versionId);
      setFlows((prev) => prev.map((f) => (f.id === flow.id ? flow : f)));
      setNodes(mapFlowNodesToReactFlow(flow.draftVersion.nodes, null));
      setEdges(mapFlowEdgesToReactFlow(flow.draftVersion.edges));
      setSelectedNodeId(flow.draftVersion.nodes[0]?.id ?? null);
      setHighlightedNodeId(null);
      setStatusMessage(
        `⏪ Flujo restaurado a la versión v${flow.draftVersion.versionNumber} (${flow.draftVersion.status === 'PUBLISHED' ? 'Publicada' : 'Borrador'}).`
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="soft-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-gradient text-white shadow-brand-icon">
            <GitBranch className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <label htmlFor="flow-selector" className="sr-only">
                Seleccionar Flujo
              </label>
              <select
                id="flow-selector"
                value={activeFlow?.id ?? ''}
                onChange={(e) => handleSelectFlow(e.target.value)}
                className="rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-sm font-extrabold text-soft-ink"
              >
                {flows.map((flow) => (
                  <option key={flow.id} value={flow.id}>
                    {flow.name} (v{flow.activeVersionNumber})
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => newFlowDialogRef.current?.showModal()}
                className="inline-flex items-center gap-1 rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-xs font-extrabold text-soft-ink hover:border-soft-blue"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Nuevo Flujo</span>
              </button>

              {activeFlow?.versions && activeFlow.versions.length > 0 ? (
                <div className="inline-flex items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-2.5 py-1">
                  <History className="h-3.5 w-3.5 text-soft-blue" />
                  <label htmlFor="flow-version-selector" className="sr-only">
                    Restaurar versión anterior
                  </label>
                  <select
                    id="flow-version-selector"
                    disabled={isSaving}
                    value={activeFlow.draftVersion.id}
                    onChange={(e) => void handleRestoreVersion(e.target.value)}
                    className="bg-transparent text-xs font-bold text-soft-ink focus:outline-none"
                  >
                    {activeFlow.versions.map((ver) => (
                      <option key={ver.id} value={ver.id}>
                        v{ver.versionNumber} ·{' '}
                        {ver.status === 'PUBLISHED' ? 'Publicada' : 'Borrador'} (
                        {new Date(ver.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                        )
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-soft-muted">
              {activeFlow?.description ??
                'Arrastra nodos, conéctalos y prueba tu flujo en tiempo real.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleSaveOrPublish(false)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-extrabold text-soft-ink hover:border-soft-blue"
          >
            <Save className="h-3.5 w-3.5 text-soft-blue" />
            <span>Guardar Borrador</span>
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleSaveOrPublish(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-gradient px-4 py-2 text-xs font-extrabold text-white shadow-brand-icon"
          >
            <Rocket className="h-3.5 w-3.5" />
            <span>
              Publicar Versión v{(activeFlow?.activeVersionNumber ?? 1) + 1}
            </span>
          </button>
        </div>
      </section>

      {statusMessage ? (
        <div
          role="status"
          className="flex items-center justify-between rounded-2xl border border-[#82d616]/40 bg-[#82d616]/15 px-4 py-2.5 text-xs font-bold text-soft-ink"
        >
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-[#4b830d]" />
            {statusMessage}
          </span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-xs underline"
          >
            Ocultar
          </button>
        </div>
      ) : null}

      <section className="soft-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
            Paleta de 12 Nodos Conversacionales (Haz clic para agregar al flujo)
          </span>
          <span className="text-[11px] text-soft-muted">
            Variables soportadas: <code>{'{{nombre}}'}</code>,{' '}
            <code>{'{{telefono}}'}</code>, <code>{'{{cedula}}'}</code>,{' '}
            <code>{'{{estado_pedido}}'}</code>
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {NODE_PALETTE.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => handleAddNodeFromPalette(item)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-xs font-bold text-soft-ink transition-transform hover:-translate-y-0.5 hover:border-soft-blue"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: item.badgeColor }}
              />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px_360px]">
        <div className="soft-card h-[560px] overflow-hidden border border-soft-line p-2">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
            fitView
          >
            <Background gap={18} size={1} />
            <Controls />
            <MiniMap zoomable pannable />
          </ReactFlow>
        </div>

        <FlowNodeInspector
          selectedNode={selectedNode}
          onUpdateData={updateSelectedNodeData}
          onDeleteNode={handleDeleteSelectedNode}
        />

        <div className="h-[560px]">
          {activeFlow ? (
            <FlowSimulatorPanel
              key={activeFlow.id}
              flowId={activeFlow.id}
              flowName={activeFlow.name}
              onHighlightNode={(nodeId) => {
                setHighlightedNodeId(nodeId);
                setNodes((prev) =>
                  prev.map((n) => ({
                    ...n,
                    style: {
                      ...n.style,
                      border:
                        n.id === nodeId
                          ? '3px solid #82d616'
                          : '2px solid #2152ff'
                    }
                  }))
                );
              }}
            />
          ) : null}
        </div>
      </section>

      <dialog
        ref={newFlowDialogRef}
        aria-labelledby={newFlowDialogTitleId}
        className="w-full max-w-md rounded-2xl border border-soft-line bg-soft-card p-6 text-soft-ink shadow-soft"
      >
        <h2 id={newFlowDialogTitleId} className="text-lg font-extrabold text-soft-ink">
          Crear Nuevo Flujo Visual
        </h2>
        <form onSubmit={handleCreateNewFlow} className="mt-4 flex flex-col gap-3">
          <div>
            <label
              htmlFor="create-flow-name"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Nombre del Flujo *
            </label>
            <input
              id="create-flow-name"
              type="text"
              required
              autoFocus
              placeholder="Ej: Calificación de Leads Inmobiliarios"
              value={newFlowName}
              onChange={(e) => setNewFlowName(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
            />
          </div>

          <div>
            <label
              htmlFor="create-flow-bot"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Asignar a Bot (Opcional)
            </label>
            <select
              id="create-flow-bot"
              value={newFlowBotId}
              onChange={(e) => setNewFlowBotId(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
            >
              <option value="">Sin asignar aún</option>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.phoneNumber})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="create-flow-desc"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Descripción
            </label>
            <textarea
              id="create-flow-desc"
              rows={2}
              value={newFlowDesc}
              onChange={(e) => setNewFlowDesc(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
            />
          </div>

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => newFlowDialogRef.current?.close()}
              className="rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-bold text-soft-ink"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-xl bg-brand-gradient px-5 py-2 text-xs font-extrabold text-white shadow-brand-icon"
            >
              Crear Flujo
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
