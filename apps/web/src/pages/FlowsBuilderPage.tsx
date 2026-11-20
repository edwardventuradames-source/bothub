import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  addEdge,
  useEdgesState,
  useNodesState
} from '@xyflow/react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  GitBranch
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
import { FlowCanvasPanel, FlowPaletteSection } from '../components/flows/FlowCanvasPanel.js';
import { FlowEditorHeader } from '../components/flows/FlowEditorHeader.js';
import { FlowsCatalogView } from '../components/flows/FlowsCatalogView.js';
import { FlowSimulatorPanel } from '../components/flows/FlowSimulatorPanel.js';
import { FlowNodeInspector } from '../components/flows/FlowNodeInspector.js';
import { CreateFlowDialog, DeleteFlowDialog } from '../components/flows/FlowDialogs.js';
import {
  FLOW_DEFAULT_EDGE_OPTIONS,
  PaletteNodeOption,
  buildFlowNodeLabel,
  getFlowNodeAccentColor,
  mapFlowEdgesToReactFlow,
  mapFlowNodesToReactFlow
} from '../components/flows/flow-palette.js';

export function FlowsBuilderPage() {
  const { flowId: routeFlowId } = useParams<{ flowId?: string }>();
  const navigate = useNavigate();
  const outletContext = useOutletContext<{ searchQuery?: string } | null>();
  const newFlowDialogRef = useRef<HTMLDialogElement | null>(null);
  const deleteFlowDialogRef = useRef<HTMLDialogElement | null>(null);
  const loadedFlowIdRef = useRef<string | null>(null);

  const user = useAuthStore((s) => s.user);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const canEditFlows = user?.role === 'ADMIN' || user?.role === 'OPERATOR';

  const [flows, setFlows] = useState<FlowDto[]>([]);
  const [bots, setBots] = useState<BotDto[]>([]);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogBotFilter, setCatalogBotFilter] = useState('ALL');
  const [deleteTargetFlow, setDeleteTargetFlow] = useState<FlowDto | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingBot, setIsUpdatingBot] = useState(false);
  const [chatwootLabels, setChatwootLabels] = useState<ChatwootLabelDto[]>([]);
  const [isLoadingLabels, setIsLoadingLabels] = useState(false);
  const [labelsError, setLabelsError] = useState<string | null>(null);

  const [newFlowName, setNewFlowName] = useState('');
  const [newFlowDesc, setNewFlowDesc] = useState('');
  const [newFlowBotId, setNewFlowBotId] = useState('');

  const [nodes, setNodes, rawOnNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, rawOnEdgesChange] = useEdgesState<Edge>([]);

  const effectiveCatalogSearch = catalogSearch || outletContext?.searchQuery || '';

  const activeFlow = useMemo(() => {
    if (!routeFlowId) return null;
    return flows.find((f) => f.id === routeFlowId) ?? null;
  }, [flows, routeFlowId]);

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
      const removedIds = new Set(
        changes.filter((c) => c.type === 'remove').map((c) => c.id)
      );
      if (removedIds.size > 0) {
        setSelectedEdgeId((prev) => (prev && removedIds.has(prev) ? null : prev));
      }
      if (changes.some((c) => c.type !== 'select')) {
        setHasUnsavedChanges(true);
      }
    },
    [rawOnEdgesChange]
  );

  const applyFlowToCanvas = useCallback(
    (target: FlowDto) => {
      setNodes(mapFlowNodesToReactFlow(target.draftVersion.nodes, null));
      setEdges(mapFlowEdgesToReactFlow(target.draftVersion.edges));
      setSelectedNodeId(target.draftVersion.nodes[0]?.id ?? null);
      setSelectedEdgeId(null);
      setHighlightedNodeId(null);
      setHasUnsavedChanges(false);
    },
    [setEdges, setNodes]
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
  }, []);

  useEffect(() => {
    if (!routeFlowId) {
      loadedFlowIdRef.current = null;
      return;
    }
    if (isLoading) return;
    const target = flows.find((f) => f.id === routeFlowId);
    if (target && loadedFlowIdRef.current !== target.id) {
      loadedFlowIdRef.current = target.id;
      applyFlowToCanvas(target);
    }
  }, [routeFlowId, flows, isLoading, applyFlowToCanvas]);

  function handleSelectFlow(flowId: string): void {
    if (!flowId) return;
    navigate(`/flows/${flowId}`);
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      setHasUnsavedChanges(true);
      setEdges((eds) =>
        addEdge(
          {
            ...FLOW_DEFAULT_EDGE_OPTIONS,
            ...connection,
            id: `edge-${Date.now()}`,
            label: 'Continuar'
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
          ...FLOW_DEFAULT_EDGE_OPTIONS,
          id: `e-${selectedNodeId}-${newNodeId}`,
          source: selectedNodeId,
          target: newNodeId,
          label: 'Siguiente'
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
    setSelectedEdgeId(null);
    setHasUnsavedChanges(true);
    setFeedback({ type: 'ok', text: 'Nodo eliminado del flujo.' });
  }

  function handleDeleteSelectedEdge(): void {
    if (!selectedEdgeId || !canEditFlows) return;
    setEdges((prev) => prev.filter((e) => e.id !== selectedEdgeId));
    setSelectedEdgeId(null);
    setHasUnsavedChanges(true);
    setFeedback({ type: 'ok', text: 'Conexión eliminada del flujo.' });
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
          ...FLOW_DEFAULT_EDGE_OPTIONS,
          id: `e-${sourceNodeId}-${sourceHandle}-${targetNodeId}`,
          source: sourceNodeId,
          sourceHandle,
          target: targetNodeId,
          label: label ?? sourceHandle
        }
      ];
    });
  }

  const serializedGraph = useMemo(() => {
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

    return { nodes: serializedNodes, edges: serializedEdges };
  }, [nodes, edges]);

  async function handleSaveOrPublish(publish: boolean): Promise<void> {
    if (!activeFlow || !canEditFlows || isSaving) return;
    setIsSaving(true);
    try {
      const { nodes: serializedNodes, edges: serializedEdges } = serializedGraph;

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
      loadedFlowIdRef.current = null;
      setNewFlowName('');
      setNewFlowDesc('');
      newFlowDialogRef.current?.close();
      navigate(`/flows/${flow.id}`);
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

  function requestDeleteFlow(flow: FlowDto): void {
    setDeleteTargetFlow(flow);
    deleteFlowDialogRef.current?.showModal();
  }

  async function handleConfirmDeleteFlow(): Promise<void> {
    const target = deleteTargetFlow ?? activeFlow;
    if (!target || !canEditFlows || isSaving) return;
    const deletedId = target.id;
    setIsSaving(true);
    try {
      await flowsApi.remove(deletedId);
      const remaining = flows.filter((f) => f.id !== deletedId);
      setFlows(remaining);
      setDeleteTargetFlow(null);
      deleteFlowDialogRef.current?.close();
      if (routeFlowId === deletedId) {
        loadedFlowIdRef.current = null;
        setNodes([]);
        setEdges([]);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setHasUnsavedChanges(false);
        navigate('/flows');
      }
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
      setSelectedEdgeId(null);
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

  async function handleAssignFlowBot(
    flowId: string,
    botId: string | null
  ): Promise<boolean> {
    if (!canEditFlows || isUpdatingBot) return false;
    setIsUpdatingBot(true);
    try {
      const { flow } = await flowsApi.updateMetadata(flowId, { botId });
      const botsRes = await botsApi.list();
      setFlows((prev) => prev.map((f) => (f.id === flow.id ? flow : f)));
      setBots(botsRes.bots);
      setFeedback({
        type: 'ok',
        text: flow.botName
          ? `Flujo "${flow.name}" asignado al bot "${flow.botName}".`
          : `Se desvinculó el bot del flujo "${flow.name}".`
      });
      return true;
    } catch (err) {
      setFeedback({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo actualizar el bot del flujo.'
      });
      return false;
    } finally {
      setIsUpdatingBot(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {!routeFlowId ? (
        <FlowsCatalogView
          flows={flows}
          bots={bots}
          isLoading={isLoading}
          canEditFlows={canEditFlows}
          isUpdatingBot={isUpdatingBot}
          searchQuery={effectiveCatalogSearch}
          onSearchQueryChange={setCatalogSearch}
          botFilterId={catalogBotFilter}
          onBotFilterChange={setCatalogBotFilter}
          feedback={feedback}
          onDismissFeedback={() => setFeedback(null)}
          onClearFilters={() => {
            setCatalogSearch('');
            setCatalogBotFilter('ALL');
          }}
          onOpenCreateDialog={() => newFlowDialogRef.current?.showModal()}
          onRequestDeleteFlow={requestDeleteFlow}
          onAssignBot={handleAssignFlowBot}
        />
      ) : (
        <>
          <FlowEditorHeader
            flows={flows}
            bots={bots}
            activeFlow={activeFlow}
            canEditFlows={canEditFlows}
            isSaving={isSaving}
            isUpdatingBot={isUpdatingBot}
            onSelectFlow={handleSelectFlow}
            onAssignBot={handleAssignFlowBot}
            onOpenCreateDialog={() => newFlowDialogRef.current?.showModal()}
            onRestoreVersion={(verId) => void handleRestoreVersion(verId)}
            onRequestDeleteFlow={requestDeleteFlow}
            onSaveDraft={() => void handleSaveOrPublish(false)}
            onPublishVersion={() => void handleSaveOrPublish(true)}
          />

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
            Flujo no encontrado
          </h2>
          <p className="max-w-md text-xs text-soft-muted">
            El flujo solicitado no existe o fue eliminado. Regresa al catálogo para elegir otro flujo o crear uno nuevo.
          </p>
          <Link
            to="/flows"
            className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-brand-gradient px-5 py-2.5 text-xs font-extrabold text-white shadow-brand-icon"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Volver al listado de flujos</span>
          </Link>
        </div>
      ) : activeFlow ? (
        <>
          <FlowPaletteSection
            canEditFlows={canEditFlows}
            hasSelectedEdge={Boolean(selectedEdgeId)}
            onAddNode={handleAddNodeFromPalette}
            onDeleteSelectedEdge={handleDeleteSelectedEdge}
          />

          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-[1fr_340px_360px]">
            <FlowCanvasPanel
              nodes={nodes}
              edges={edges}
              resolvedTheme={resolvedTheme}
              canEditFlows={canEditFlows}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onEdgesDelete={() => {
                setSelectedEdgeId(null);
                setHasUnsavedChanges(true);
                setFeedback({ type: 'ok', text: 'Conexión eliminada del flujo.' });
              }}
              onConnect={onConnect}
              onSelectNode={(nodeId) => {
                setSelectedNodeId(nodeId);
                setSelectedEdgeId(null);
              }}
              onSelectEdge={(edgeId) => {
                setSelectedEdgeId(edgeId);
                setSelectedNodeId(null);
              }}
              onClearEdgeSelection={() => {
                setSelectedEdgeId(null);
              }}
            />

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
                  currentNodes={serializedGraph.nodes}
                  currentEdges={serializedGraph.edges}
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
        </>
      )}

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
        flowName={deleteTargetFlow?.name ?? activeFlow?.name ?? ''}
        isSaving={isSaving}
        onConfirm={() => void handleConfirmDeleteFlow()}
      />
    </div>
  );
}
