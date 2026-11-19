import { Edge, Node } from '@xyflow/react';
import { Sparkles, Trash2 } from 'lucide-react';
import { FlowNodeType, QuestionValidationType } from '@bothub/shared';
import { InteractiveOptionsInspector } from './InteractiveOptionsInspector.js';

interface FlowNodeInspectorProps {
  selectedNode: Node | null;
  allNodes: Node[];
  edges: Edge[];
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
  selectedNode,
  allNodes,
  edges,
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
              title="Eliminar nodo seleccionado"
              className="rounded-lg border border-soft-danger/30 bg-soft-danger/10 p-1.5 text-soft-danger"
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
                  type="url"
                  placeholder="https://..."
                  value={String(selectedNode.data.mediaUrl ?? '')}
                  onChange={(e) => onUpdateData('mediaUrl', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
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
                  <option value="NOT_EMPTY">No está vacío</option>
                  <option value="GREATER_THAN">Mayor que</option>
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
                  value={String(selectedNode.data.compareValue ?? '')}
                  onChange={(e) => onUpdateData('compareValue', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
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

          {selectedNodeType === 'HTTP_REQUEST' ? (
            <>
              <div>
                <label
                  htmlFor="http-method"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Método HTTP
                </label>
                <select
                  id="http-method"
                  value={String(selectedNode.data.method ?? 'GET')}
                  onChange={(e) => onUpdateData('method', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="http-url"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Endpoint URL (Soporta {'{{cedula}}'})
                </label>
                <input
                  id="http-url"
                  type="text"
                  value={String(selectedNode.data.url ?? '')}
                  onChange={(e) => onUpdateData('url', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
              </div>
              <div>
                <label
                  htmlFor="http-var"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Guardar Respuesta en Variable
                </label>
                <input
                  id="http-var"
                  type="text"
                  value={String(
                    selectedNode.data.responseVariable ?? 'estado_pedido'
                  )}
                  onChange={(e) =>
                    onUpdateData('responseVariable', e.target.value)
                  }
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
              </div>
            </>
          ) : null}

          {selectedNodeType === 'AI_PROMPT' ? (
            <>
              <div>
                <label
                  htmlFor="ai-prompt"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  System Prompt del Agente IA
                </label>
                <textarea
                  id="ai-prompt"
                  rows={4}
                  value={String(selectedNode.data.systemPrompt ?? '')}
                  onChange={(e) => onUpdateData('systemPrompt', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
              </div>
              <div>
                <label
                  htmlFor="ai-model"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Modelo LLM
                </label>
                <select
                  id="ai-model"
                  value={String(selectedNode.data.model ?? 'gpt-4o-mini')}
                  onChange={(e) => onUpdateData('model', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                >
                  <option value="gpt-4o-mini">OpenAI GPT-4o Mini</option>
                  <option value="claude-3-5-sonnet-latest">Claude 3.5 Sonnet</option>
                  <option value="gemini-2.5-flash">Google Gemini 2.5 Flash</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="ai-fallback"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Mensaje Alterno si Falla la API IA (Opcional)
                </label>
                <input
                  id="ai-fallback"
                  type="text"
                  value={String(selectedNode.data.fallbackMessage ?? '')}
                  onChange={(e) => onUpdateData('fallbackMessage', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
              </div>
            </>
          ) : null}

          {selectedNodeType === 'ASSIGN_TAG' ? (
            <div>
              <label
                htmlFor="assign-tags-input"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Etiquetas (separadas por coma)
              </label>
              <input
                id="assign-tags-input"
                type="text"
                value={
                  Array.isArray(selectedNode.data.tags)
                    ? (selectedNode.data.tags as string[]).join(', ')
                    : ''
                }
                onChange={(e) =>
                  onUpdateData(
                    'tags',
                    e.target.value
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean)
                  )
                }
                className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
              />
            </div>
          ) : null}

          {selectedNodeType === 'DELAY' ? (
            <div>
              <label
                htmlFor="delay-seconds-input"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Segundos de Espera / Escribiendo (0 - 15s)
              </label>
              <input
                id="delay-seconds-input"
                type="number"
                min={0}
                max={15}
                value={Number(selectedNode.data.delaySeconds ?? 2)}
                onChange={(e) =>
                  onUpdateData('delaySeconds', Number(e.target.value) || 0)
                }
                className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
              />
            </div>
          ) : null}

          {selectedNodeType === 'HANDOFF' ? (
            <>
              <div>
                <label
                  htmlFor="ho-msg"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Mensaje al Cliente Antes de Transferir
                </label>
                <textarea
                  id="ho-msg"
                  rows={2}
                  value={String(selectedNode.data.clientMessage ?? '')}
                  onChange={(e) => onUpdateData('clientMessage', e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
              </div>
              <div>
                <label
                  htmlFor="ho-note"
                  className="mb-1 block text-xs font-bold text-soft-ink"
                >
                  Nota Privada de Resumen en Chatwoot
                </label>
                <textarea
                  id="ho-note"
                  rows={3}
                  value={String(selectedNode.data.privateNoteTemplate ?? '')}
                  onChange={(e) =>
                    onUpdateData('privateNoteTemplate', e.target.value)
                  }
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
              </div>
            </>
          ) : null}

          {selectedNodeType === 'END' ? (
            <div>
              <label
                htmlFor="end-farewell-input"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Mensaje de Despedida
              </label>
              <textarea
                id="end-farewell-input"
                rows={3}
                value={String(selectedNode.data.farewellMessage ?? '')}
                onChange={(e) => onUpdateData('farewellMessage', e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
              />
            </div>
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
