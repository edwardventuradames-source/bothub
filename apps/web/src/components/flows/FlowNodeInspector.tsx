import { Edge, Node } from '@xyflow/react';
import { Sparkles, Trash2 } from 'lucide-react';
import {
  ChatwootLabelDto,
  FlowNodeType,
  QuestionValidationType
} from '@bothub/shared';
import { FlowActionNodesInspector } from './FlowActionNodesInspector.js';
import { InteractiveOptionsInspector } from './InteractiveOptionsInspector.js';

interface FlowNodeInspectorProps {
  flowId?: string;
  selectedNode: Node | null;
  allNodes: Node[];
  edges: Edge[];
  chatwootLabels?: ChatwootLabelDto[];
  isLoadingChatwootLabels?: boolean;
  chatwootLabelsError?: string | null;
  hasLinkedChatwootBot?: boolean;
  onRefreshChatwootLabels?: () => void;
  onUpdateData: (key: string, value: unknown) => void;
  onSetBranchEdge: (
    sourceNodeId: string,
    sourceHandle: string,
    targetNodeId: string,
    label?: string
  ) => void;
  onDeleteNode: () => void;
}

export function FlowNodeInspector({
  flowId,
  selectedNode,
  allNodes,
  edges,
  chatwootLabels = [],
  isLoadingChatwootLabels = false,
  chatwootLabelsError = null,
  hasLinkedChatwootBot = false,
  onRefreshChatwootLabels,
  onUpdateData,
  onSetBranchEdge,
  onDeleteNode
}: FlowNodeInspectorProps) {
  const selectedNodeType = (selectedNode?.data?.nodeType as FlowNodeType) ?? null;

  return (
    <div className="soft-card flex h-[560px] flex-col justify-between overflow-y-auto p-4">
      {selectedNode ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-soft-line pb-2.5">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-soft-blue">
                Inspector de Propiedades
              </span>
              <h3 className="text-sm font-extrabold text-soft-ink">
                Nodo: {selectedNodeType}
              </h3>
            </div>
            <button
              type="button"
              onClick={onDeleteNode}
              aria-label="Eliminar nodo seleccionado"
              title="Eliminar nodo seleccionado"
              className="grid min-h-[36px] min-w-[36px] place-items-center rounded-lg border border-soft-danger/30 bg-soft-danger/10 p-1.5 text-soft-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <div>
            <label
              htmlFor="node-title-input"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Título del Nodo
            </label>
            <input
              id="node-title-input"
              type="text"
              value={String(selectedNode.data.title ?? '')}
              onChange={(e) => onUpdateData('title', e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
            />
          </div>

          {selectedNodeType === 'TRIGGER' ? (
            <>
              <div>
                <label
                  htmlFor="trig-mode"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Modo de Disparo
                </label>
                <select
                  id="trig-mode"
                  value={String(selectedNode.data.matchMode ?? 'FIRST_MESSAGE')}
                  onChange={(e) => onUpdateData('matchMode', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                >
                  <option value="FIRST_MESSAGE">Primer mensaje entrante</option>
                  <option value="CONTAINS">Contiene palabra clave</option>
                  <option value="EXACT">Coincidencia exacta</option>
                  <option value="REGEX">Expresión Regular (Regex)</option>
                  <option value="MAIN_MENU">Menú Principal</option>
                  <option value="OUT_OF_HOURS">Fuera de horario</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="trig-kw"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Palabras Clave / Patrón
                </label>
                <input
                  id="trig-kw"
                  type="text"
                  value={String(selectedNode.data.keyword ?? '')}
                  onChange={(e) => onUpdateData('keyword', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
              </div>
            </>
          ) : null}

          {selectedNodeType === 'MESSAGE' ? (
            <>
              <div>
                <label
                  htmlFor="msg-text"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Texto del Mensaje (Soporta variables)
                </label>
                <textarea
                  id="msg-text"
                  rows={4}
                  value={String(selectedNode.data.text ?? '')}
                  onChange={(e) => onUpdateData('text', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
              </div>
              <div>
                <label
                  htmlFor="msg-media"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  URL Multimedia Opcional (Imagen / PDF / Audio)
                </label>
                <input
                  id="msg-media"
                  type="text"
                  placeholder="https://cdn.midominio.com/imagen.png o {{archivo}}"
                  value={String(selectedNode.data.mediaUrl ?? '')}
                  onChange={(e) => onUpdateData('mediaUrl', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
                {typeof selectedNode.data.mediaUrl === 'string' &&
                selectedNode.data.mediaUrl.trim().length > 0 ? (
                  <div className="mt-2 rounded-xl border border-soft-line bg-soft-bg p-2">
                    {/^https?:\/\/.+/i.test(selectedNode.data.mediaUrl.trim()) ? (
                      <>
                        {/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|txt|zip|mp3|ogg|wav|m4a|mp4|mov)(\?|$)/i.test(
                          selectedNode.data.mediaUrl.trim()
                        ) ? (
                          <a
                            href={selectedNode.data.mediaUrl.trim()}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-[11px] font-bold text-soft-blue underline"
                          >
                            📎 Multimedia configurada: {selectedNode.data.mediaUrl.trim()}
                          </a>
                        ) : (
                          <img
                            src={selectedNode.data.mediaUrl.trim()}
                            alt="Vista previa multimedia"
                            className="max-h-28 w-full rounded-lg object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        )}
                        {/\.webp(\?|$)/i.test(selectedNode.data.mediaUrl.trim()) ? (
                          <p className="mt-1.5 text-[10px] font-semibold text-soft-warning">
                            ⚠️ WhatsApp oficial solo acepta imágenes .png o .jpg como foto; .webp puede no mostrarse en el celular.
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-[11px] font-semibold text-soft-muted">
                        Se enviará adjunto dinámico si resuelve a URL `http(s)://...` válida.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {selectedNodeType === 'QUESTION' ? (
            <>
              <div>
                <label
                  htmlFor="q-prompt"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Pregunta para el Usuario
                </label>
                <textarea
                  id="q-prompt"
                  rows={3}
                  value={String(selectedNode.data.promptText ?? '')}
                  onChange={(e) => onUpdateData('promptText', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
              </div>
              <div>
                <label
                  htmlFor="q-var"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Guardar en Variable (sin llaves)
                </label>
                <input
                  id="q-var"
                  type="text"
                  value={String(selectedNode.data.variableName ?? 'cedula')}
                  onChange={(e) => onUpdateData('variableName', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
              </div>
              <div>
                <label
                  htmlFor="q-val-type"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Tipo de Validación
                </label>
                <select
                  id="q-val-type"
                  value={String(selectedNode.data.validationType ?? 'NATIONAL_ID')}
                  onChange={(e) =>
                    onUpdateData(
                      'validationType',
                      e.target.value as QuestionValidationType
                    )
                  }
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                >
                  <option value="NATIONAL_ID">Cédula / NIT (6-12 dígitos)</option>
                  <option value="EMAIL">Correo Electrónico</option>
                  <option value="NUMBER">Número</option>
                  <option value="DATE">Fecha (YYYY-MM-DD)</option>
                  <option value="TEXT">Texto libre</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="q-err"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Mensaje de Error en Reintento
                </label>
                <input
                  id="q-err"
                  type="text"
                  value={String(selectedNode.data.errorMessage ?? '')}
                  onChange={(e) => onUpdateData('errorMessage', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
              </div>
            </>
          ) : null}

          {selectedNodeType === 'BUTTONS' || selectedNodeType === 'LIST' ? (
            <>
              <div>
                <label
                  htmlFor="interactive-body"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Texto del Menú Interactivo
                </label>
                <textarea
                  id="interactive-body"
                  rows={3}
                  value={String(selectedNode.data.bodyText ?? '')}
                  onChange={(e) => onUpdateData('bodyText', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
              </div>
              <InteractiveOptionsInspector
                selectedNode={selectedNode}
                nodeType={selectedNodeType}
                allNodes={allNodes}
                edges={edges}
                onUpdateData={onUpdateData}
                onSetBranchEdge={onSetBranchEdge}
              />
            </>
          ) : null}

          {selectedNodeType === 'CONDITION' ? (
            <>
              <div>
                <label
                  htmlFor="cond-var"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Variable a Evaluar
                </label>
                <input
                  id="cond-var"
                  type="text"
                  value={String(selectedNode.data.variableName ?? 'cedula')}
                  onChange={(e) => onUpdateData('variableName', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
              </div>
              <div>
                <label
                  htmlFor="cond-op"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Operador Lógico
                </label>
                <select
                  id="cond-op"
                  value={String(selectedNode.data.operator ?? 'CONTAINS')}
                  onChange={(e) => onUpdateData('operator', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                >
                  <option value="CONTAINS">Contiene</option>
                  <option value="EQUALS">Es igual a</option>
                  <option value="NOT_EQUALS">No es igual a</option>
                  <option value="NOT_EMPTY">No está vacío</option>
                  <option value="GREATER_THAN">Mayor que</option>
                  <option value="LESS_THAN">Menor que</option>
                  <option value="REGEX">Coincide Regex</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="cond-val"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Valor Comparado
                </label>
                <input
                  id="cond-val"
                  type="text"
                  disabled={String(selectedNode.data.operator ?? 'CONTAINS') === 'NOT_EMPTY'}
                  placeholder={
                    String(selectedNode.data.operator ?? 'CONTAINS') === 'NOT_EMPTY'
                      ? 'No requerido para "No está vacío"'
                      : 'Valor o expresión...'
                  }
                  value={String(selectedNode.data.compareValue ?? '')}
                  onChange={(e) => onUpdateData('compareValue', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink disabled:opacity-60"
                />
              </div>
              <InteractiveOptionsInspector
                selectedNode={selectedNode}
                nodeType="CONDITION"
                allNodes={allNodes}
                edges={edges}
                onUpdateData={onUpdateData}
                onSetBranchEdge={onSetBranchEdge}
              />
            </>
          ) : null}

          {selectedNodeType ? (
            <FlowActionNodesInspector
              flowId={flowId}
              selectedNode={selectedNode}
              nodeType={selectedNodeType}
              chatwootLabels={chatwootLabels}
              isLoadingChatwootLabels={isLoadingChatwootLabels}
              chatwootLabelsError={chatwootLabelsError}
              hasLinkedChatwootBot={hasLinkedChatwootBot}
              onRefreshChatwootLabels={onRefreshChatwootLabels}
              onUpdateData={onUpdateData}
            />
          ) : null}
        </div>
      ) : (
        <div className="grid h-full place-items-center text-center text-xs text-soft-muted">
          <div>
            <Sparkles className="mx-auto h-7 w-7 text-soft-blue" />
            <p className="mt-2 font-bold">
              Haz clic en cualquier nodo del lienzo para editar sus propiedades, botones, validaciones y textos.
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl bg-soft-bg p-3 text-[11px] text-soft-muted">
        💡 <strong>Tip:</strong> Conecta nodos arrastrando en el lienzo o asigna el destino de cada botón directamente desde el inspector.
      </div>
    </div>
  );
}
