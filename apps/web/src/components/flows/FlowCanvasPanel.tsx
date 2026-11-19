import {
  Background,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  MiniMap,
  Node,
  NodeChange,
  ReactFlow
} from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import { FlowNodeType } from '@bothub/shared';
import {
  FLOW_DEFAULT_EDGE_OPTIONS,
  FLOW_DELETE_KEYS,
  FLOW_NODE_PALETTE,
  PaletteNodeOption,
  getFlowNodeAccentColor
} from './flow-palette.js';

interface FlowPaletteSectionProps {
  canEditFlows: boolean;
  hasSelectedEdge: boolean;
  onAddNode: (option: PaletteNodeOption) => void;
  onDeleteSelectedEdge: () => void;
}

export function FlowPaletteSection({
  canEditFlows,
  hasSelectedEdge,
  onAddNode,
  onDeleteSelectedEdge
}: FlowPaletteSectionProps) {
  return (
    <section className="soft-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
          Paleta de 12 Nodos Conversacionales (Haz clic para agregar al flujo)
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {canEditFlows && hasSelectedEdge ? (
            <button
              type="button"
              onClick={onDeleteSelectedEdge}
              className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-soft-danger/40 bg-soft-danger/10 px-2.5 py-1 text-[11px] font-extrabold text-soft-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Eliminar Conexión (Del)</span>
            </button>
          ) : null}
          <span className="text-[11px] text-soft-muted">
            Variables: <code>{'{{nombre}}'}</code>, <code>{'{{telefono}}'}</code>,{' '}
            <code>{'{{cedula}}'}</code> · Elimina líneas con clic + <code>Delete</code>/<code>Backspace</code>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FLOW_NODE_PALETTE.map((item) => (
          <button
            key={item.type}
            type="button"
            disabled={!canEditFlows}
            onClick={() => onAddNode(item)}
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
  );
}

interface FlowCanvasPanelProps {
  nodes: Node[];
  edges: Edge[];
  resolvedTheme: 'light' | 'dark';
  canEditFlows: boolean;
  onNodesChange: (changes: NodeChange<Node>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  onEdgesDelete: () => void;
  onConnect: (connection: Connection) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onClearEdgeSelection: () => void;
}

export function FlowCanvasPanel({
  nodes,
  edges,
  resolvedTheme,
  canEditFlows,
  onNodesChange,
  onEdgesChange,
  onEdgesDelete,
  onConnect,
  onSelectNode,
  onSelectEdge,
  onClearEdgeSelection
}: FlowCanvasPanelProps) {
  return (
    <div className="soft-card h-[460px] min-w-0 overflow-hidden border border-soft-line p-2 lg:col-span-2 2xl:col-span-1 2xl:h-[580px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        colorMode={resolvedTheme}
        deleteKeyCode={canEditFlows ? FLOW_DELETE_KEYS : null}
        elementsSelectable={canEditFlows}
        edgesFocusable={canEditFlows}
        nodesConnectable={canEditFlows}
        elevateEdgesOnSelect
        defaultEdgeOptions={FLOW_DEFAULT_EDGE_OPTIONS}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        onNodeClick={(_event, node) => {
          onSelectNode(node.id);
        }}
        onEdgeClick={(_event, edge) => {
          onSelectEdge(edge.id);
        }}
        onPaneClick={onClearEdgeSelection}
        fitView
      >
        <Background gap={18} size={1} />
        <Controls />
        <MiniMap
          zoomable
          pannable
          style={{ width: 160, height: 120 }}
          nodeColor={(node) =>
            getFlowNodeAccentColor((node.data?.nodeType as FlowNodeType) || 'MESSAGE')
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
  );
}
