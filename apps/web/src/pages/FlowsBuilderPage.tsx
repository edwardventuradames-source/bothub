import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Connection,
  Edge,
  EdgeChange,
  MiniMap,
  Node,
  NodeChange,
  ReactFlow,
  Controls,
  addEdge,
  useEdgesState,
  useNodesState
} from '@xyflow/react';
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  History,
  Plus,
  Rocket,
  Save,
  Trash2
} from 'lucide-react';
import {
  BotDto,
  ChatwootLabelDto,
  FlowDto,
  FlowEdge,
  FlowNode,
  FlowNodeType
} from '@bothub/shared';
import { botsApi, flowsApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.store.js';
import { useThemeStore } from '../store/theme.store.js';
import { FlowSimulatorPanel } from '../components/flows/FlowSimulatorPanel.js';
import { FlowNodeInspector } from '../components/flows/FlowNodeInspector.js';
import { CreateFlowDialog, DeleteFlowDialog } from '../components/flows/FlowDialogs.js';
import {
  FLOW_NODE_PALETTE,
  PaletteNodeOption,
  buildFlowNodeLabel,
  getFlowNodeAccentColor,
  mapFlowEdgesToReactFlow,
  mapFlowNodesToReactFlow
} from '../components/flows/flow-palette.js';

export function FlowsBuilderPage() {
  const newFlowDialogRef = useRef<HTMLDialogElement | null>(null);
  const deleteFlowDialogRef = useRef<HTMLDialogElement | null>(null);

  const user = useAuthStore((s) => s.user);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const canEditFlows = user?.role === 'ADMIN' || user?.role === 'OPERATOR';

  const [flows, setFlows] = useState<FlowDto[]>([]);
  const [bots, setBots] = useState<BotDto[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [chatwootLabels, setChatwootLabels] = useState<ChatwootLabelDto[]>([]);
  const [isLoadingLabels, setIsLoadingLabels] = useState(false);
  const [labelsError, setLabelsError] = useState<string | null>(null);

  const [newFlowName, setNewFlowName] = useState('');
  const [newFlowDesc, setNewFlowDesc] = useState('');
  const [newFlowBotId, setNewFlowBotId] = useState('');

  const [nodes, setNodes, rawOnNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, rawOnEdgesChange] = useEdgesState<Edge>([]);

  const activeFlow = useMemo(
    () => flows.find((f) => f.id === selectedFlowId) ?? flows[0] ?? null,
    [flows, selectedFlowId]
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const linkedChatwootBot = useMemo(() => {
    if (!activeFlow) return null;
    const directBot = bots.find(
      (b) => b.id === activeFlow.botId && Boolean(b.chatwootConfig)
    );
    if (directBot) return directBot;
    const assignedBot = bots.find(
      (b) => b.activeFlowId === activeFlow.id && Boolean(b.chatwootConfig)
    );
    if (assignedBot) return assignedBot;
    return bots.find((b) => Boolean(b.chatwootConfig)) ?? null;
  }, [activeFlow, bots]);

  const fetchChatwootLabels = useCallback(async (botId: string) => {
    setIsLoadingLabels(true);
    setLabelsError(null);
    try {
      const res = await botsApi.listChatwootLabels(botId);
      setChatwootLabels(res.labels);
    } catch (err) {
      setLabelsError(
        err instanceof Error
          ? err.message
          : 'No se pudieron obtener las etiquetas de Chatwoot.'
      );
      setChatwootLabels([]);
    } finally {
      setIsLoadingLabels(false);
    }
  }, []);

  useEffect(() => {
    if (linkedChatwootBot) {
      void fetchChatwootLabels(linkedChatwootBot.id);
    } else {
      setChatwootLabels([]);
      setLabelsError(null);
    }
  }, [linkedChatwootBot, fetchChatwootLabels]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      rawOnNodesChange(changes);
      if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')) {
        setHasUnsavedChanges(true);
      }
    },
    [rawOnNodesChange]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      rawOnEdgesChange(changes);
      if (changes.some((c) => c.type !== 'select')) {
        setHasUnsavedChanges(true);
      }
    },
    [rawOnEdgesChange]
  );

  useEffect(() => {
    async function loadInitial(): Promise<void> {
      setIsLoading(true);
      try {
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
          setHasUnsavedChanges(false);
        }
      } catch (err) {
        setFeedback({
          type: 'err',
          text:
            err instanceof Error
              ? err.message
              : 'No se pudieron cargar los flujos visuales.'
        });
      } finally {
        setIsLoading(false);
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
      setHasUnsavedChanges(false);
    }
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      setHasUnsavedChanges(true);
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
    if (!canEditFlows || !activeFlow) return;
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
    setHasUnsavedChanges(true);
    setFeedback({
      type: 'ok',
      text: `Nodo [${option.type}] añadido al lienzo.`
    });
  }

  function updateSelectedNodeData(key: string, value: unknown): void {
    if (!selectedNodeId || !canEditFlows) return;
    setHasUnsavedChanges(true);
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

        return {
          ...node,
          data: {
            ...nextData,
            label: buildFlowNodeLabel(nodeType, nextData)
          }
        };
      })
    );
  }

  function handleDeleteSelectedNode(): void {
    if (!selectedNodeId || !canEditFlows) return;
    setNodes((prev) => prev.filter((n) => n.id !== selectedNodeId));
    setEdges((prev) =>
      prev.filter(
        (e) => e.source !== selectedNodeId && e.target !== selectedNodeId
      )
    );
    setSelectedNodeId(null);
    setHasUnsavedChanges(true);
    setFeedback({ type: 'ok', text: 'Nodo eliminado del flujo.' });
  }

  function handleSetBranchEdge(
    sourceNodeId: string,
    sourceHandle: string,
    targetNodeId: string,
    label?: string
  ): void {
    if (!canEditFlows) return;
    setHasUnsavedChanges(true);
    setEdges((prev) => {
      const filtered = prev.filter(
        (e) => !(e.source === sourceNodeId && e.sourceHandle === sourceHandle)
      );
      if (!targetNodeId) {
        return filtered;
      }
      return [
        ...filtered,
        {
          id: `e-${sourceNodeId}-${sourceHandle}-${targetNodeId}`,
          source: sourceNodeId,
          sourceHandle,
          target: targetNodeId,
          label: label ?? sourceHandle,
          animated: true,
          style: { stroke: '#2152ff', strokeWidth: 2 }
        }
      ];
    });
  }

  async function handleSaveOrPublish(publish: boolean): Promise<void> {
    if (!activeFlow || !canEditFlows || isSaving) return;
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
      setHasUnsavedChanges(false);
      setFeedback({
        type: 'ok',
        text: publish
          ? `Flujo publicado en producción (Versión v${flow.activeVersionNumber}).`
          : `Borrador guardado (${serializedNodes.length} nodos, ${serializedEdges.length} conexiones).`
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo guardar los cambios del flujo.'
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateNewFlow(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!newFlowName.trim() || !canEditFlows || isSaving) return;
    setIsSaving(true);
    try {
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
      setHasUnsavedChanges(false);
      setNewFlowName('');
      setNewFlowDesc('');
      newFlowDialogRef.current?.close();
      setFeedback({
        type: 'ok',
        text: `Nuevo flujo "${flow.name}" creado y listo para editar.`
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo crear el flujo.'
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirmDeleteFlow(): Promise<void> {
    if (!activeFlow || !canEditFlows || isSaving) return;
    const deletedId = activeFlow.id;
    setIsSaving(true);
    try {
      await flowsApi.remove(deletedId);
      const remaining = flows.filter((f) => f.id !== deletedId);
      setFlows(remaining);
      deleteFlowDialogRef.current?.close();
      if (remaining[0]) {
        setSelectedFlowId(remaining[0].id);
        setNodes(mapFlowNodesToReactFlow(remaining[0].draftVersion.nodes, null));
        setEdges(mapFlowEdgesToReactFlow(remaining[0].draftVersion.edges));
        setSelectedNodeId(remaining[0].draftVersion.nodes[0]?.id ?? null);
      } else {
        setSelectedFlowId('');
        setNodes([]);
        setEdges([]);
        setSelectedNodeId(null);
      }
      setHasUnsavedChanges(false);
      setFeedback({ type: 'ok', text: 'Flujo eliminado correctamente.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo eliminar el flujo.'
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRestoreVersion(versionId: string): Promise<void> {
    if (!activeFlow || !versionId || !canEditFlows || isSaving) return;
    setIsSaving(true);
    try {
      const { flow } = await flowsApi.restoreVersion(activeFlow.id, versionId);
      setFlows((prev) => prev.map((f) => (f.id === flow.id ? flow : f)));
      setNodes(mapFlowNodesToReactFlow(flow.draftVersion.nodes, null));
      setEdges(mapFlowEdgesToReactFlow(flow.draftVersion.edges));
      setSelectedNodeId(flow.draftVersion.nodes[0]?.id ?? null);
      setHighlightedNodeId(null);
      setHasUnsavedChanges(false);
      setFeedback({
        type: 'ok',
        text: `Flujo restaurado a la versión v${flow.draftVersion.versionNumber} (${
          flow.draftVersion.status === 'PUBLISHED' ? 'Publicada' : 'Borrador'
        }).`
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo restaurar la versión seleccionada.'
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="soft-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-gradient text-white shadow-brand-icon">
            <GitBranch className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="flow-selector" className="sr-only">
                Seleccionar Flujo
              </label>
              <select
                id="flow-selector"
                value={activeFlow?.id ?? ''}
                disabled={flows.length === 0}
                onChange={(e) => handleSelectFlow(e.target.value)}
                className="min-h-[40px] max-w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-sm font-extrabold text-soft-ink"
              >
                {flows.length === 0 ? (
                  <option value="">Sin flujos disponibles</option>
                ) : (
                  flows.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name} (v{flow.activeVersionNumber})
                    </option>
                  ))
                )}
              </select>

              {canEditFlows ? (
                <button
                  type="button"
                  onClick={() => newFlowDialogRef.current?.showModal()}
                  className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-xs font-extrabold text-soft-ink hover:border-soft-blue"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Nuevo Flujo</span>
                </button>
              ) : null}

              {activeFlow?.versions && activeFlow.versions.length > 0 ? (
                <div className="inline-flex min-h-[40px] max-w-full items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-2.5 py-1">
                  <History className="h-3.5 w-3.5 shrink-0 text-soft-blue" />
                  <label htmlFor="flow-version-selector" className="sr-only">
                    Restaurar versión anterior
                  </label>
                  <select
                    id="flow-version-selector"
                    disabled={isSaving || !canEditFlows}
                    value={activeFlow.draftVersion.id}
                    onChange={(e) => void handleRestoreVersion(e.target.value)}
                    className="max-w-[200px] truncate bg-transparent text-xs font-bold text-soft-ink focus:outline-none sm:max-w-none"
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

              {canEditFlows && activeFlow ? (
                <button
                  type="button"
                  onClick={() => deleteFlowDialogRef.current?.showModal()}
                  aria-label={`Eliminar flujo ${activeFlow.name}`}
                  title="Eliminar flujo actual"
                  className="grid min-h-[40px] min-w-[40px] place-items-center rounded-xl border border-soft-line bg-soft-bg text-soft-danger hover:border-soft-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <p className="mt-1.5 text-xs text-soft-muted">
              {activeFlow?.description ??
                'Crea tu primer flujo conversacional para diseñar nodos y simular respuestas.'}
            </p>
          </div>
        </div>

        {canEditFlows && activeFlow ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleSaveOrPublish(false)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-extrabold text-soft-ink hover:border-soft-blue disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5 text-soft-blue" />
              <span>Guardar Borrador</span>
            </button>

            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleSaveOrPublish(true)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-brand-gradient px-4 py-2 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
            >
              <Rocket className="h-3.5 w-3.5" />
              <span>
                Publicar Versión v{(activeFlow?.activeVersionNumber ?? 1) + 1}
              </span>
            </button>
          </div>
        ) : null}
      </section>

      {hasUnsavedChanges ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-soft-warning/40 bg-soft-warning/10 px-4 py-2.5 text-xs font-bold text-soft-ink"
        >
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-soft-warning" />
            Hay cambios sin guardar en el lienzo. Guarda el borrador para que el probador en vivo ejecute los últimos nodos editados.
          </span>
        </div>
      ) : null}

      {feedback ? (
        <div
          role={feedback.type === 'err' ? 'alert' : 'status'}
          className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 text-xs font-bold ${
            feedback.type === 'ok'
              ? 'border-[#82d616]/40 bg-[#82d616]/15 text-soft-ink'
              : 'border-soft-danger/40 bg-soft-danger/15 text-soft-danger'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2
              className={`h-4 w-4 shrink-0 ${
                feedback.type === 'ok'
                  ? 'text-[#4b830d] dark:text-[#82d616]'
                  : 'text-soft-danger'
              }`}
            />
            {feedback.text}
          </span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline"
          >
            Ocultar
          </button>
        </div>
      ) : null}

      {!isLoading && !activeFlow ? (
        <div className="soft-card flex flex-col items-center justify-center gap-3 p-10 text-center">
          <GitBranch className="h-8 w-8 text-soft-blue" />
          <h2 className="text-base font-extrabold text-soft-ink">
            Aún no hay flujos creados
          </h2>
          <p className="max-w-md text-xs text-soft-muted">
            Crea un nuevo flujo conversacional para arrastrar disparadores, preguntas validadas, peticiones HTTP y handoff hacia Chatwoot.
          </p>
          {canEditFlows ? (
            <button
              type="button"
              onClick={() => newFlowDialogRef.current?.showModal()}
              className="mt-1 min-h-[44px] rounded-xl bg-brand-gradient px-5 py-2.5 text-xs font-extrabold text-white shadow-brand-icon"
            >
              + Crear Mi Primer Flujo
            </button>
          ) : null}
        </div>
      ) : activeFlow ? (
        <>
          <section className="soft-card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
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
              {FLOW_NODE_PALETTE.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  disabled={!canEditFlows}
                  onClick={() => handleAddNodeFromPalette(item)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-xs font-bold text-soft-ink transition-transform hover:-translate-y-0.5 hover:border-soft-blue disabled:cursor-not-allowed disabled:opacity-50"
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

          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-[1fr_340px_360px]">
            <div className="soft-card h-[460px] min-w-0 overflow-hidden border border-soft-line p-2 lg:col-span-2 2xl:col-span-1 2xl:h-[580px]">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                colorMode={resolvedTheme}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
                fitView
              >
                <Background gap={18} size={1} />
                <Controls />
                <MiniMap
                  zoomable
                  pannable
                  style={{ width: 160, height: 120 }}
                  nodeColor={(node) =>
                    getFlowNodeAccentColor(
                      (node.data?.nodeType as FlowNodeType) || 'MESSAGE'
                    )
                  }
                  nodeStrokeColor={resolvedTheme === 'dark' ? '#f8fafc' : '#1e293b'}
                  nodeStrokeWidth={2}
                  bgColor={resolvedTheme === 'dark' ? '#0f172a' : '#f8fafc'}
                  maskColor={
                    resolvedTheme === 'dark'
                      ? 'rgba(15, 23, 42, 0.65)'
                      : 'rgba(203, 213, 225, 0.55)'
                  }
                  className="hidden sm:block"
                />
              </ReactFlow>
            </div>

            <FlowNodeInspector
              selectedNode={selectedNode}
              allNodes={nodes}
              edges={edges}
              chatwootLabels={chatwootLabels}
              isLoadingChatwootLabels={isLoadingLabels}
              chatwootLabelsError={labelsError}
              hasLinkedChatwootBot={Boolean(linkedChatwootBot)}
              onRefreshChatwootLabels={() => {
                if (linkedChatwootBot) {
                  void fetchChatwootLabels(linkedChatwootBot.id);
                }
              }}
              onUpdateData={updateSelectedNodeData}
              onSetBranchEdge={handleSetBranchEdge}
              onDeleteNode={handleDeleteSelectedNode}
            />

            <div className="h-[560px] min-w-0">
              {canEditFlows ? (
                <FlowSimulatorPanel
                  key={activeFlow.id}
                  flowId={activeFlow.id}
                  flowName={activeFlow.name}
                  onHighlightNode={(nodeId) => {
                    setHighlightedNodeId(nodeId);
                    setNodes((prev) =>
                      prev.map((n) => {
                        const nodeType = String(
                          n.data?.nodeType || 'MESSAGE'
                        ) as FlowNodeType;
                        const accent = getFlowNodeAccentColor(nodeType);
                        return {
                          ...n,
                          style: {
                            ...n.style,
                            border:
                              n.id === nodeId
                                ? '3px solid #82d616'
                                : `2px solid ${accent}`
                          }
                        };
                      })
                    );
                  }}
                />
              ) : (
                <div className="soft-card flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                  <AlertTriangle className="h-6 w-6 text-soft-warning" />
                  <h3 className="text-sm font-extrabold text-soft-ink">
                    Simulador en modo solo lectura
                  </h3>
                  <p className="text-xs text-soft-muted">
                    Tu rol actual (VIEWER) solo permite visualizar flujos. Inicia sesión como OPERATOR o ADMIN para ejecutar simulaciones.
                  </p>
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}

      <CreateFlowDialog
        dialogRef={newFlowDialogRef}
        name={newFlowName}
        description={newFlowDesc}
        botId={newFlowBotId}
        bots={bots}
        isSaving={isSaving}
        onNameChange={setNewFlowName}
        onDescriptionChange={setNewFlowDesc}
        onBotIdChange={setNewFlowBotId}
        onSubmit={handleCreateNewFlow}
      />

      <DeleteFlowDialog
        dialogRef={deleteFlowDialogRef}
        flowName={activeFlow?.name ?? ''}
        isSaving={isSaving}
        onConfirm={() => void handleConfirmDeleteFlow()}
      />
    </div>
  );
}
