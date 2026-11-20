import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Node } from '@xyflow/react';
import { Play, RefreshCw, Sparkles, Tag } from 'lucide-react';
import {
  AiProviderConfigDto,
  AiProviderId,
  ChatwootLabelDto,
  FlowHttpExecutionLog,
  FlowNode,
  FlowNodeType,
  TestFlowAiNodeResponse
} from '@bothub/shared';
import { flowsApi, platformApi } from '../../lib/api.js';
import { HttpExecutionDetailsCard } from './HttpExecutionDetailsCard.js';

interface FlowActionNodesInspectorProps {
  flowId?: string;
  selectedNode: Node;
  nodeType: FlowNodeType;
  chatwootLabels: ChatwootLabelDto[];
  isLoadingChatwootLabels: boolean;
  chatwootLabelsError: string | null;
  hasLinkedChatwootBot: boolean;
  onRefreshChatwootLabels?: () => void;
  onUpdateData: (key: string, value: unknown) => void;
}

function collectHttpTemplateVariables(data: Record<string, unknown>): string[] {
  const sources: string[] = [
    String(data.url ?? ''),
    String(data.responsePath ?? ''),
    String(data.bodyTemplate ?? '')
  ];
  if (data.headers && typeof data.headers === 'object') {
    for (const val of Object.values(data.headers as Record<string, unknown>)) {
      if (typeof val === 'string') {
        sources.push(val);
      }
    }
  }
  const found = new Set<string>();
  const regex = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  for (const text of sources) {
    let match: RegExpExecArray | null = regex.exec(text);
    while (match) {
      const rootName = match[1].split('.')[0]?.trim();
      if (rootName) {
        found.add(rootName);
      }
      match = regex.exec(text);
    }
    regex.lastIndex = 0;
  }
  return Array.from(found);
}

export function FlowActionNodesInspector({
  flowId,
  selectedNode,
  nodeType,
  chatwootLabels,
  isLoadingChatwootLabels,
  chatwootLabelsError,
  hasLinkedChatwootBot,
  onRefreshChatwootLabels,
  onUpdateData
}: FlowActionNodesInspectorProps) {
  const [tagInputText, setTagInputText] = useState('');
  const [headersInputText, setHeadersInputText] = useState('');
  const [headersJsonError, setHeadersJsonError] = useState<string | null>(null);
  const [testVariables, setTestVariables] = useState<Record<string, string>>({});
  const [isTestingHttp, setIsTestingHttp] = useState(false);
  const [httpTestResult, setHttpTestResult] = useState<FlowHttpExecutionLog | null>(null);
  const [httpTestError, setHttpTestError] = useState<string | null>(null);
  const [aiProviders, setAiProviders] = useState<AiProviderConfigDto[]>([]);
  const [aiTestInput, setAiTestInput] = useState('Hola, necesito información de sus servicios');
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<TestFlowAiNodeResponse | null>(null);
  const [aiTestError, setAiTestError] = useState<string | null>(null);

  const detectedHttpVars = useMemo(
    () =>
      nodeType === 'HTTP_REQUEST'
        ? collectHttpTemplateVariables(selectedNode.data as Record<string, unknown>)
        : [],
    [nodeType, selectedNode.data]
  );

  useEffect(() => {
    const rawTags = Array.isArray(selectedNode.data.tags)
      ? (selectedNode.data.tags as string[])
      : [];
    setTagInputText(rawTags.join(', '));
    const rawHeaders = selectedNode.data.headers;
    if (rawHeaders && typeof rawHeaders === 'object' && Object.keys(rawHeaders).length > 0) {
      setHeadersInputText(JSON.stringify(rawHeaders, null, 2));
    } else {
      setHeadersInputText('');
    }
    setHeadersJsonError(null);
    setHttpTestResult(null);
    setHttpTestError(null);
    setAiTestResult(null);
    setAiTestError(null);
  }, [selectedNode.id]);

  useEffect(() => {
    if (nodeType !== 'AI_PROMPT') {
      return;
    }
    let cancelled = false;
    void platformApi
      .getAiProviders()
      .then((res) => {
        if (!cancelled) {
          setAiProviders(res.aiProviders);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAiProviders([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [nodeType]);

  async function handleRunAiNodeTest(): Promise<void> {
    if (!flowId || isTestingAi) {
      return;
    }
    setIsTestingAi(true);
    setAiTestError(null);
    try {
      const { label: _lbl, nodeType: _nt, ...cleanData } = selectedNode.data as Record<
        string,
        unknown
      >;
      const payloadNode: FlowNode = {
        id: selectedNode.id,
        type: 'AI_PROMPT',
        position: selectedNode.position,
        data: cleanData
      };
      const res = await flowsApi.testAiNode(flowId, {
        node: payloadNode,
        inputMessage: aiTestInput.trim() || 'Hola',
        variables: { ultimo_mensaje: aiTestInput.trim() || 'Hola' }
      });
      setAiTestResult(res);
    } catch (err) {
      setAiTestError(
        err instanceof Error ? err.message : 'No se pudo probar el nodo IA.'
      );
      setAiTestResult(null);
    } finally {
      setIsTestingAi(false);
    }
  }

  async function handleRunHttpNodeTest(): Promise<void> {
    if (!flowId || isTestingHttp) {
      return;
    }
    setIsTestingHttp(true);
    setHttpTestError(null);
    try {
      const { label: _lbl, nodeType: _nt, ...cleanData } = selectedNode.data as Record<
        string,
        unknown
      >;
      const payloadNode: FlowNode = {
        id: selectedNode.id,
        type: 'HTTP_REQUEST',
        position: selectedNode.position,
        data: cleanData
      };
      const res = await flowsApi.testHttpNode(flowId, {
        node: payloadNode,
        variables: testVariables
      });
      setHttpTestResult(res.httpDetails);
    } catch (err) {
      setHttpTestError(
        err instanceof Error ? err.message : 'No se pudo ejecutar la prueba HTTP.'
      );
      setHttpTestResult(null);
    } finally {
      setIsTestingHttp(false);
    }
  }

  if (nodeType === 'HTTP_REQUEST') {
    return (
      <>
        <div>
          <label htmlFor="http-method" className="mb-1 block text-xs font-bold text-soft-ink">
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
            <option value="DELETE">DELETE</option>
          </select>
        </div>
        <div>
          <label htmlFor="http-url" className="mb-1 block text-xs font-bold text-soft-ink">
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
          <label htmlFor="http-var" className="mb-1 block text-xs font-bold text-soft-ink">
            Guardar Respuesta en Variable
          </label>
          <input
            id="http-var"
            type="text"
            value={String(selectedNode.data.responseVariable ?? 'estado_pedido')}
            onChange={(e) => onUpdateData('responseVariable', e.target.value)}
            className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
          />
        </div>
        <div>
          <label htmlFor="http-path" className="mb-1 block text-xs font-bold text-soft-ink">
            Ruta JSON a Extraer (Opcional)
          </label>
          <input
            id="http-path"
            type="text"
            placeholder="data.status o data[cedula={{cedula}}].status"
            value={String(selectedNode.data.responsePath ?? '')}
            onChange={(e) => onUpdateData('responsePath', e.target.value)}
            className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
          />
          <p className="mt-1 text-[10px] leading-snug text-soft-muted">
            Objeto: <code>data.status</code> · Lista por índice: <code>data[0].status</code> · Buscar en lista: <code>data[cedula={'{{cedula}}'}].status</code>
          </p>
        </div>
        {String(selectedNode.data.method ?? 'GET') !== 'GET' ? (
          <div>
            <label htmlFor="http-body" className="mb-1 block text-xs font-bold text-soft-ink">
              Cuerpo JSON (Body Template)
            </label>
            <textarea
              id="http-body"
              rows={3}
              placeholder={'{"documento":"{{cedula}}"}'}
              value={String(selectedNode.data.bodyTemplate ?? '')}
              onChange={(e) => onUpdateData('bodyTemplate', e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 font-mono text-[11px] text-soft-ink"
            />
          </div>
        ) : null}
        <div>
          <label htmlFor="http-headers" className="mb-1 block text-xs font-bold text-soft-ink">
            Headers JSON (Opcional)
          </label>
          <textarea
            id="http-headers"
            rows={2}
            placeholder={'{"Authorization":"Bearer ..."}'}
            value={headersInputText}
            onChange={(e) => {
              const nextText = e.target.value;
              setHeadersInputText(nextText);
              if (!nextText.trim()) {
                setHeadersJsonError(null);
                onUpdateData('headers', undefined);
                return;
              }
              try {
                const parsed = JSON.parse(nextText) as Record<string, unknown>;
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                  setHeadersJsonError(null);
                  onUpdateData('headers', parsed);
                } else {
                  setHeadersJsonError('Debe ser un objeto JSON clave/valor.');
                }
              } catch {
                setHeadersJsonError('JSON de headers inválido.');
              }
            }}
            className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 font-mono text-[11px] text-soft-ink"
          />
          {headersJsonError ? (
            <p className="mt-1 text-[10px] font-bold text-soft-danger">{headersJsonError}</p>
          ) : null}
        </div>

        {flowId ? (
          <div className="mt-1 flex flex-col gap-2.5 rounded-xl border border-soft-line bg-soft-bg p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
                Probar Petición HTTP
              </span>
              <button
                type="button"
                disabled={isTestingHttp}
                onClick={() => void handleRunHttpNodeTest()}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-brand-gradient px-3 py-1 text-[11px] font-extrabold text-white shadow-brand-icon disabled:opacity-60"
              >
                <Play className="h-3 w-3" />
                <span>{isTestingHttp ? 'Enviando...' : 'Probar'}</span>
              </button>
            </div>

            {detectedHttpVars.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-soft-muted">
                  Variables de prueba detectadas:
                </span>
                {detectedHttpVars.map((varName) => (
                  <div key={varName} className="flex items-center gap-2">
                    <label
                      htmlFor={`http-test-var-${varName}`}
                      className="w-24 shrink-0 truncate font-mono text-[10px] font-bold text-soft-blue"
                    >
                      {`{{${varName}}}`}
                    </label>
                    <input
                      id={`http-test-var-${varName}`}
                      type="text"
                      placeholder={`Valor de ${varName}...`}
                      value={testVariables[varName] ?? ''}
                      onChange={(e) =>
                        setTestVariables((prev) => ({
                          ...prev,
                          [varName]: e.target.value
                        }))
                      }
                      className="min-w-0 flex-1 rounded-lg border border-soft-line bg-soft-card px-2 py-1 text-[11px] text-soft-ink"
                    />
                  </div>
                ))}
              </div>
            ) : null}

            {httpTestError ? (
              <p className="text-[11px] font-bold text-soft-danger">{httpTestError}</p>
            ) : null}

            {httpTestResult ? (
              <HttpExecutionDetailsCard details={httpTestResult} />
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  if (nodeType === 'AI_PROMPT') {
    const selectedModel = String(selectedNode.data.model ?? 'gpt-4o-mini');
    const selectedProviderId: AiProviderId = selectedModel.toLowerCase().startsWith('claude')
      ? 'anthropic'
      : selectedModel.toLowerCase().startsWith('gemini')
        ? 'gemini'
        : 'openai';
    const providerStatus = aiProviders.find((p) => p.provider === selectedProviderId);

    return (
      <>
        <div
          className={`rounded-xl border px-3 py-2.5 text-[11px] ${
            providerStatus?.hasKey
              ? 'border-[#82d616]/40 bg-[#82d616]/10 text-soft-ink'
              : 'border-amber-400/50 bg-amber-500/10 text-soft-ink'
          }`}
        >
          {providerStatus ? (
            providerStatus.hasKey ? (
              <div className="flex items-center justify-between gap-2">
                <span>
                  ✅ <strong>{providerStatus.label}</strong> conectado ({providerStatus.maskedKey})
                </span>
                <Link to="/settings" className="shrink-0 font-extrabold text-soft-blue underline">
                  Cambiar
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <span>
                  ⚠️ <strong>{providerStatus.label} no está conectado.</strong> Conecta tu API Key para que este nodo responda.
                </span>
                <Link to="/settings" className="font-extrabold text-soft-blue underline">
                  Ir a Configuración → Proveedores IA →
                </Link>
              </div>
            )
          ) : (
            <span>Verificando conexión del proveedor IA...</span>
          )}
        </div>

        <div>
          <label htmlFor="ai-prompt" className="mb-1 block text-xs font-bold text-soft-ink">
            System Prompt del Agente IA
          </label>
          <textarea
            id="ai-prompt"
            rows={4}
            placeholder="Ej: Eres un asesor de ByteMV. Responde breve y usa {{nombre}}."
            value={String(selectedNode.data.systemPrompt ?? '')}
            onChange={(e) => onUpdateData('systemPrompt', e.target.value)}
            className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
          />
        </div>
        <div>
          <label htmlFor="ai-user-prompt" className="mb-1 block text-xs font-bold text-soft-ink">
            Prompt / Mensaje al Modelo (Opcional)
          </label>
          <input
            id="ai-user-prompt"
            type="text"
            placeholder="Por defecto usa el mensaje del cliente ({{ultimo_mensaje}})"
            value={String(selectedNode.data.userPrompt ?? '')}
            onChange={(e) => onUpdateData('userPrompt', e.target.value)}
            className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
          />
        </div>
        <div>
          <label htmlFor="ai-model" className="mb-1 block text-xs font-bold text-soft-ink">
            Modelo LLM
          </label>
          <select
            id="ai-model"
            value={selectedModel}
            onChange={(e) => onUpdateData('model', e.target.value)}
            className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
          >
            <option value="gpt-4o-mini">OpenAI GPT-4o Mini</option>
            <option value="gpt-4o">OpenAI GPT-4o</option>
            <option value="gpt-4.1-mini">OpenAI GPT-4.1 Mini</option>
            <option value="gemini-2.5-flash">Google Gemini 2.5 Flash</option>
            <option value="gemini-2.5-pro">Google Gemini 2.5 Pro</option>
            <option value="claude-sonnet-4-20250514">Anthropic Claude Sonnet 4</option>
            <option value="claude-3-5-haiku-latest">Anthropic Claude 3.5 Haiku</option>
            {selectedModel === 'claude-3-5-sonnet-latest' ? (
              <option value="claude-3-5-sonnet-latest">
                Claude 3.5 Sonnet Legacy (obsoleto — cambia a Sonnet 4)
              </option>
            ) : null}
          </select>
        </div>
        <div>
          <label htmlFor="ai-save-var" className="mb-1 block text-xs font-bold text-soft-ink">
            Guardar Respuesta en Variable
          </label>
          <input
            id="ai-save-var"
            type="text"
            value={String(selectedNode.data.saveToVariable ?? 'respuesta_ia')}
            onChange={(e) => onUpdateData('saveToVariable', e.target.value)}
            className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
          />
        </div>
        <div>
          <label htmlFor="ai-fallback" className="mb-1 block text-xs font-bold text-soft-ink">
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

        {flowId ? (
          <div className="flex flex-col gap-2 rounded-xl border border-soft-line bg-soft-bg p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-soft-ink">
              <Sparkles className="h-3.5 w-3.5 text-soft-blue" />
              <span>Probar Respuesta IA en Vivo</span>
            </div>
            <input
              type="text"
              aria-label="Mensaje de prueba para IA"
              value={aiTestInput}
              onChange={(e) => setAiTestInput(e.target.value)}
              placeholder="Escribe un mensaje de prueba..."
              className="w-full rounded-lg border border-soft-line bg-soft-card px-2.5 py-1.5 text-xs text-soft-ink"
            />
            <button
              type="button"
              disabled={isTestingAi}
              onClick={() => void handleRunAiNodeTest()}
              className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-brand-gradient px-3 py-2 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{isTestingAi ? 'Consultando IA...' : 'Probar Nodo IA'}</span>
            </button>
            {aiTestError ? (
              <div className="rounded-lg border border-soft-danger/40 bg-soft-danger/10 p-2 text-[11px] font-bold text-soft-danger">
                {aiTestError}
              </div>
            ) : null}
            {aiTestResult ? (
              <div
                className={`rounded-lg border p-2.5 text-[11px] ${
                  aiTestResult.ok
                    ? 'border-[#82d616]/40 bg-[#82d616]/10 text-soft-ink'
                    : 'border-soft-danger/40 bg-soft-danger/10 text-soft-danger'
                }`}
              >
                <div className="flex items-center justify-between gap-2 font-extrabold">
                  <span>
                    {aiTestResult.ok ? `✅ OK (${aiTestResult.model})` : `❌ Error (${aiTestResult.model})`}
                  </span>
                  <span className="font-mono text-[10px]">{aiTestResult.latencyMs}ms</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap">
                  {aiTestResult.ok ? aiTestResult.text : aiTestResult.errorMessage}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  if (nodeType === 'ASSIGN_TAG') {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-bold text-soft-ink">
            <Tag className="h-3.5 w-3.5 text-soft-blue" />
            <span>Etiquetas de Chatwoot</span>
          </span>
          {hasLinkedChatwootBot && onRefreshChatwootLabels ? (
            <button
              type="button"
              disabled={isLoadingChatwootLabels}
              onClick={onRefreshChatwootLabels}
              className="inline-flex items-center gap-1 rounded-lg border border-soft-line bg-soft-bg px-2 py-1 text-[11px] font-bold text-soft-blue hover:border-soft-blue disabled:opacity-60"
            >
              <RefreshCw
                className={`h-3 w-3 ${isLoadingChatwootLabels ? 'animate-spin' : ''}`}
              />
              <span>Jalar de Chatwoot</span>
            </button>
          ) : null}
        </div>

        {chatwootLabelsError ? (
          <div className="rounded-xl border border-soft-warning/40 bg-soft-warning/10 p-2.5 text-[11px] font-semibold text-soft-ink">
            {chatwootLabelsError}
          </div>
        ) : null}

        {chatwootLabels.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-soft-line bg-soft-bg p-2.5">
            {chatwootLabels.map((cwLabel) => {
              const currentTags = Array.isArray(selectedNode.data.tags)
                ? (selectedNode.data.tags as string[])
                : [];
              const isSelected = currentTags.includes(cwLabel.title);

              return (
                <button
                  key={cwLabel.id}
                  type="button"
                  onClick={() => {
                    const nextTags = isSelected
                      ? currentTags.filter((t) => t !== cwLabel.title)
                      : [...currentTags, cwLabel.title];
                    setTagInputText(nextTags.join(', '));
                    onUpdateData('tags', nextTags);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-all ${
                    isSelected
                      ? 'border-soft-blue bg-soft-blue text-white shadow-sm'
                      : 'border-soft-line bg-soft-card text-soft-ink hover:border-soft-blue'
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: cwLabel.color || '#2152FF' }}
                  />
                  <span>{cwLabel.title}</span>
                </button>
              );
            })}
          </div>
        ) : hasLinkedChatwootBot && !isLoadingChatwootLabels && !chatwootLabelsError ? (
          <p className="text-[11px] text-soft-muted">
            No se encontraron etiquetas en la cuenta de Chatwoot o aún no se han creado allá.
          </p>
        ) : null}

        <div>
          <label htmlFor="assign-tags-input" className="mb-1 block text-xs font-bold text-soft-ink">
            Etiquetas seleccionadas (separadas por coma)
          </label>
          <input
            id="assign-tags-input"
            type="text"
            value={tagInputText}
            onChange={(e) => {
              const nextVal = e.target.value;
              setTagInputText(nextVal);
              onUpdateData(
                'tags',
                nextVal
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)
              );
            }}
            className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
          />
        </div>
      </div>
    );
  }

  if (nodeType === 'DELAY') {
    return (
      <div>
        <label htmlFor="delay-seconds-input" className="mb-1 block text-xs font-bold text-soft-ink">
          Segundos de Espera / Escribiendo (0 - 15s)
        </label>
        <input
          id="delay-seconds-input"
          type="number"
          min={0}
          max={15}
          value={Number(selectedNode.data.delaySeconds ?? 2)}
          onChange={(e) => {
            const raw = Number(e.target.value);
            const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(15, raw)) : 0;
            onUpdateData('delaySeconds', clamped);
          }}
          className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
        />
      </div>
    );
  }

  if (nodeType === 'HANDOFF') {
    return (
      <>
        <div>
          <label htmlFor="ho-team" className="mb-1 block text-xs font-bold text-soft-ink">
            Equipo / Área Destino
          </label>
          <input
            id="ho-team"
            type="text"
            placeholder="Ventas & Soporte"
            value={String(selectedNode.data.teamName ?? '')}
            onChange={(e) => onUpdateData('teamName', e.target.value)}
            className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
          />
        </div>
        <div>
          <label htmlFor="ho-msg" className="mb-1 block text-xs font-bold text-soft-ink">
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
          <label htmlFor="ho-note" className="mb-1 block text-xs font-bold text-soft-ink">
            Nota Privada de Resumen en Chatwoot
          </label>
          <textarea
            id="ho-note"
            rows={3}
            value={String(selectedNode.data.privateNoteTemplate ?? '')}
            onChange={(e) => onUpdateData('privateNoteTemplate', e.target.value)}
            className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
          />
        </div>
      </>
    );
  }

  if (nodeType === 'END') {
    return (
      <div>
        <label htmlFor="end-farewell-input" className="mb-1 block text-xs font-bold text-soft-ink">
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
    );
  }

  return null;
}
