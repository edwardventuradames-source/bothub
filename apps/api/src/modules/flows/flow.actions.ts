import { AiProviderId, FlowHttpExecutionLog, FlowNode } from '@bothub/shared';
import { runtimeStore } from '../../lib/runtime-store.js';
import {
  pinnedSafeFetch,
  resolveAndPinExternalUrl
} from '../../lib/ssrf-guard.js';
import {
  resolveFlowVariableValue,
  sanitizeVariableName
} from './flow-evaluators.js';

const ACTION_HTTP_TIMEOUT_MS = 8000;
const AI_HTTP_TIMEOUT_MS = 20000;
const MAX_RESPONSE_PREVIEW_CHARS = 1200;
const MAX_RESPONSE_LOG_CHARS = 4000;
const MAX_RESPONSE_BYTES = 262144;
const HEADER_MASK_EDGE_CHARS = 4;
const HEADER_MASK_MIN_LENGTH = 8;
const FORBIDDEN_HEADER_NAMES = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'te'
]);
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'cookie',
  'set-cookie'
]);

type JsonPathSegment =
  | { kind: 'key'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'filter'; field: string; expected: string };

function isSensitiveHeaderName(headerName: string): boolean {
  const lower = headerName.toLowerCase();
  return (
    SENSITIVE_HEADER_NAMES.has(lower) ||
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('password')
  );
}

function maskHeaderValue(value: string): string {
  if (value.length <= HEADER_MASK_MIN_LENGTH) {
    return '••••••••';
  }
  return `${value.slice(0, HEADER_MASK_EDGE_CHARS)}••••••••${value.slice(-HEADER_MASK_EDGE_CHARS)}`;
}

function sanitizeHeadersForLog(
  headers: Record<string, string>
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    sanitized[key] = isSensitiveHeaderName(key) ? maskHeaderValue(value) : value;
  }
  return sanitized;
}

function interpolateTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_.\-[\]]+)\s*\}\}/g,
    (_match, varPath: string) => {
      const resolved = resolveFlowVariableValue(varPath, variables);
      return typeof resolved === 'string' && resolved.length > 0 ? resolved : '';
    }
  );
}

function unquoteSegment(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseJsonPathSegments(pathExpr: string): JsonPathSegment[] {
  let expr = pathExpr.trim();
  if (expr.startsWith('$')) {
    expr = expr.slice(1);
  }
  if (expr.startsWith('.')) {
    expr = expr.slice(1);
  }

  const segments: JsonPathSegment[] = [];
  let cursor = 0;

  while (cursor < expr.length) {
    if (expr[cursor] === '.') {
      cursor += 1;
      continue;
    }

    if (expr[cursor] === '[') {
      const closeIndex = findClosingBracket(expr, cursor + 1);
      if (closeIndex === -1) {
        break;
      }
      const inner = expr.slice(cursor + 1, closeIndex).trim();
      segments.push(parseBracketSegment(inner));
      cursor = closeIndex + 1;
      continue;
    }

    let nextBoundary = cursor;
    while (
      nextBoundary < expr.length &&
      expr[nextBoundary] !== '.' &&
      expr[nextBoundary] !== '['
    ) {
      nextBoundary += 1;
    }
    const key = expr.slice(cursor, nextBoundary).trim();
    if (key.length > 0) {
      segments.push({ kind: 'key', key });
    }
    cursor = nextBoundary;
  }

  return segments;
}

function findClosingBracket(expr: string, startIndex: number): number {
  let quoteChar: string | null = null;
  for (let idx = startIndex; idx < expr.length; idx += 1) {
    const ch = expr[idx];
    if (quoteChar) {
      if (ch === quoteChar && expr[idx - 1] !== '\\') {
        quoteChar = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quoteChar = ch;
      continue;
    }
    if (ch === ']') {
      return idx;
    }
  }
  return -1;
}

function parseBracketSegment(inner: string): JsonPathSegment {
  if (/^\d+$/.test(inner)) {
    return { kind: 'index', index: Number(inner) };
  }

  const jsonPathFilter = inner.match(
    /^\?\(\s*@\.([a-zA-Z0-9_.-]+)\s*==\s*(['"]?)(.*?)\2\s*\)$/
  );
  if (jsonPathFilter) {
    return {
      kind: 'filter',
      field: jsonPathFilter[1],
      expected: jsonPathFilter[3]
    };
  }

  const shortFilter = inner.match(/^([a-zA-Z0-9_.-]+)\s*=\s*(['"]?)(.*?)\2$/);
  if (shortFilter) {
    return {
      kind: 'filter',
      field: shortFilter[1],
      expected: shortFilter[3]
    };
  }

  return { kind: 'key', key: unquoteSegment(inner) };
}

function readObjectFieldString(
  item: Record<string, unknown>,
  fieldPath: string
): string | null {
  const keys = fieldPath.split('.').map((k) => k.trim()).filter(Boolean);
  let cursor: unknown = item;
  for (const key of keys) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (cursor === null || cursor === undefined || typeof cursor === 'object') {
    return null;
  }
  return String(cursor).trim();
}

function extractJsonPathResult(
  payload: unknown,
  pathExpr: string
): { matched: boolean; value: string } {
  const segments = parseJsonPathSegments(pathExpr);
  if (segments.length === 0) {
    return { matched: false, value: '' };
  }

  let cursor: unknown = payload;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') {
      return { matched: false, value: '' };
    }

    if (Array.isArray(cursor)) {
      if (segment.kind === 'index') {
        cursor = cursor[segment.index];
      } else if (segment.kind === 'filter') {
        const expected = segment.expected.trim();
        cursor = cursor.find(
          (entry) =>
            entry !== null &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            readObjectFieldString(entry as Record<string, unknown>, segment.field) === expected
        );
      } else {
        const idx = Number(segment.key);
        cursor = Number.isInteger(idx) ? cursor[idx] : undefined;
      }
    } else if (segment.kind === 'key') {
      cursor = (cursor as Record<string, unknown>)[segment.key];
    } else {
      return { matched: false, value: '' };
    }
  }

  if (cursor === null || cursor === undefined) {
    return { matched: false, value: '' };
  }
  return {
    matched: true,
    value: typeof cursor === 'string' ? cursor : JSON.stringify(cursor)
  };
}

export interface HttpNodeExecutionResult {
  ok: boolean;
  renderedUrl: string;
  method: string;
  statusCode: number | null;
  value: string;
  errorMessage: string | null;
  httpDetails: FlowHttpExecutionLog;
}

export async function executeHttpRequestNode(
  node: FlowNode,
  variables: Record<string, string>
): Promise<HttpNodeExecutionResult> {
  const startedAt = Date.now();
  const rawUrl = String(node.data.url ?? '').trim();
  const method = String(node.data.method ?? 'GET').toUpperCase();
  const renderedUrl = interpolateTemplate(rawUrl, variables);
  const responseVariable = sanitizeVariableName(
    node.data.responseVariable,
    'http_response'
  );
  const rawResponsePath =
    typeof node.data.responsePath === 'string' ? node.data.responsePath.trim() : '';
  const renderedResponsePath = rawResponsePath
    ? interpolateTemplate(rawResponsePath, variables).trim()
    : '';

  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain'
  };
  if (node.data.headers && typeof node.data.headers === 'object') {
    for (const [key, val] of Object.entries(node.data.headers as Record<string, unknown>)) {
      if (typeof val === 'string' && !FORBIDDEN_HEADER_NAMES.has(key.toLowerCase())) {
        headers[key] = interpolateTemplate(val, variables);
      }
    }
  }

  const rawBody = typeof node.data.bodyTemplate === 'string' ? node.data.bodyTemplate : '';
  const hasBody = !['GET', 'HEAD'].includes(method) && rawBody.trim().length > 0;
  const renderedBody = hasBody ? interpolateTemplate(rawBody, variables) : null;
  const hasContentTypeHeader = Object.keys(headers).some(
    (key) => key.toLowerCase() === 'content-type'
  );
  if (hasBody && !hasContentTypeHeader) {
    headers['Content-Type'] = 'application/json';
  }
  const safeRequestHeaders = sanitizeHeadersForLog(headers);

  const buildResult = (params: {
    ok: boolean;
    statusCode: number | null;
    value: string;
    errorMessage: string | null;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
    responsePathMatched?: boolean;
  }): HttpNodeExecutionResult => {
    const durationMs = Math.max(0, Date.now() - startedAt);
    const httpDetails: FlowHttpExecutionLog = {
      method,
      url: renderedUrl,
      statusCode: params.statusCode,
      ok: params.ok,
      durationMs,
      requestHeaders: safeRequestHeaders,
      requestBody: renderedBody,
      responseHeaders: sanitizeHeadersForLog(params.responseHeaders ?? {}),
      responseBody: (params.responseBody ?? '').slice(0, MAX_RESPONSE_LOG_CHARS),
      responseVariable,
      responsePath: renderedResponsePath || null,
      responsePathMatched: params.responsePathMatched ?? false,
      extractedValue: params.value,
      errorMessage: params.errorMessage
    };

    return {
      ok: params.ok,
      renderedUrl,
      method,
      statusCode: params.statusCode,
      value: params.value,
      errorMessage: params.errorMessage,
      httpDetails
    };
  };

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(renderedUrl);
  } catch {
    return buildResult({
      ok: false,
      statusCode: null,
      value: '',
      errorMessage: `URL inválida en nodo HTTP: "${renderedUrl}"`
    });
  }

  try {
    const checked = await resolveAndPinExternalUrl(parsedUrl.toString(), {
      skipDnsResolution: true
    });
    parsedUrl = checked.url;
  } catch (err) {
    return buildResult({
      ok: false,
      statusCode: null,
      value: '',
      errorMessage:
        err instanceof Error
          ? err.message
          : `Host bloqueado por política de seguridad SSRF: ${parsedUrl.hostname}`
    });
  }

  try {
    const response = await pinnedSafeFetch(parsedUrl.toString(), {
      method,
      headers,
      body: renderedBody ?? undefined,
      timeoutMs: ACTION_HTTP_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES
    });

    if (response.status >= 300 && response.status < 400) {
      return buildResult({
        ok: false,
        statusCode: response.status,
        value: '',
        responseHeaders: response.headers,
        responseBody: response.text,
        errorMessage: 'Redirección HTTP bloqueada por política de seguridad SSRF.'
      });
    }

    const rawText = response.text.trim();
    let extractedValue = rawText.slice(0, MAX_RESPONSE_PREVIEW_CHARS);
    let responsePathMatched = renderedResponsePath.length === 0;

    const contentType = (response.headers['content-type'] ?? '').toLowerCase();
    const looksLikeJson =
      contentType.includes('application/json') ||
      rawText.startsWith('{') ||
      rawText.startsWith('[') ||
      rawText.startsWith('"');

    if (looksLikeJson && rawText.length > 0) {
      try {
        const parsedJson = JSON.parse(rawText) as unknown;
        if (renderedResponsePath) {
          const pathResult = extractJsonPathResult(parsedJson, renderedResponsePath);
          extractedValue = pathResult.value;
          responsePathMatched = pathResult.matched;
        } else if (typeof parsedJson === 'string') {
          extractedValue = parsedJson.slice(0, MAX_RESPONSE_PREVIEW_CHARS);
        } else if (typeof parsedJson === 'number' || typeof parsedJson === 'boolean') {
          extractedValue = String(parsedJson);
        } else if (parsedJson !== null) {
          extractedValue = JSON.stringify(parsedJson).slice(0, MAX_RESPONSE_PREVIEW_CHARS);
        }
      } catch {
        extractedValue = renderedResponsePath
          ? ''
          : rawText.slice(0, MAX_RESPONSE_PREVIEW_CHARS);
        responsePathMatched = renderedResponsePath.length === 0;
      }
    } else if (renderedResponsePath) {
      extractedValue = '';
      responsePathMatched = false;
    }

    if (!response.ok) {
      return buildResult({
        ok: false,
        statusCode: response.status,
        value: extractedValue,
        responseHeaders: response.headers,
        responseBody: response.text,
        responsePathMatched,
        errorMessage: `HTTP ${response.status} al consultar ${parsedUrl.hostname}`
      });
    }

    return buildResult({
      ok: true,
      statusCode: response.status,
      value: extractedValue,
      responseHeaders: response.headers,
      responseBody: response.text,
      responsePathMatched,
      errorMessage: null
    });
  } catch (err) {
    return buildResult({
      ok: false,
      statusCode: null,
      value: '',
      errorMessage: err instanceof Error ? err.message : 'Error de red en petición HTTP'
    });
  }
}

export function resolveAiProviderFromModel(model: string): AiProviderId {
  const lower = model.trim().toLowerCase();
  if (lower.startsWith('claude')) {
    return 'anthropic';
  }
  if (lower.startsWith('gemini')) {
    return 'gemini';
  }
  return 'openai';
}

function buildMissingAiKeyMessage(provider: AiProviderId): string {
  if (provider === 'anthropic') {
    return 'Falta API Key de Anthropic (ANTHROPIC_API_KEY). Configúrala en Configuración > Inteligencia Artificial.';
  }
  if (provider === 'gemini') {
    return 'Falta API Key de Gemini (GEMINI_API_KEY). Configúrala en Configuración > Inteligencia Artificial.';
  }
  return 'Falta API Key de OpenAI (OPENAI_API_KEY). Configúrala en Configuración > Inteligencia Artificial.';
}

async function extractAiHttpErrorMessage(
  providerLabel: string,
  response: Response
): Promise<string> {
  try {
    const raw = await response.text();
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    const upstreamMsg = parsed.error?.message || parsed.message;
    if (typeof upstreamMsg === 'string' && upstreamMsg.trim().length > 0) {
      return `${providerLabel} HTTP ${response.status}: ${upstreamMsg.trim().slice(0, 180)}`;
    }
  } catch {
    void 0;
  }
  return `${providerLabel} API HTTP ${response.status}`;
}

export async function executeAiPromptNode(
  node: FlowNode,
  variables: Record<string, string>,
  latestInput: string,
  organizationId?: string
): Promise<{
  ok: boolean;
  provider: AiProviderId;
  model: string;
  text: string;
  errorMessage: string | null;
  latencyMs: number;
  keySource: 'organization' | 'env' | 'none';
}> {
  const startedAt = Date.now();
  const model = String(node.data.model ?? 'gpt-4o-mini').trim() || 'gpt-4o-mini';
  const provider = resolveAiProviderFromModel(model);
  const rawSystemPrompt = String(
    node.data.systemPrompt ?? 'Eres un asistente útil y amable.'
  );
  const systemPrompt = interpolateTemplate(rawSystemPrompt, variables);
  const rawUserPrompt =
    typeof node.data.userPrompt === 'string' ? node.data.userPrompt.trim() : '';
  const userMessage =
    (rawUserPrompt ? interpolateTemplate(rawUserPrompt, variables).trim() : '') ||
    latestInput.trim() ||
    variables.ultimo_mensaje ||
    'Hola';

  const { apiKey, source: keySource } = runtimeStore.resolveAiApiKey(
    organizationId,
    provider
  );
  if (!apiKey) {
    return {
      ok: false,
      provider,
      model,
      text: '',
      errorMessage: buildMissingAiKeyMessage(provider),
      latencyMs: Date.now() - startedAt,
      keySource
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_HTTP_TIMEOUT_MS);

  try {
    if (provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }]
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        return {
          ok: false,
          provider,
          model,
          text: '',
          errorMessage: await extractAiHttpErrorMessage('Anthropic', response),
          latencyMs: Date.now() - startedAt,
          keySource
        };
      }

      const data = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = data.content?.find((c) => c.type === 'text')?.text?.trim() ?? '';
      return {
        ok: text.length > 0,
        provider,
        model,
        text,
        errorMessage: text ? null : 'Respuesta vacía de Anthropic',
        latencyMs: Date.now() - startedAt,
        keySource
      };
    }

    if (provider === 'gemini') {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }]
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        return {
          ok: false,
          provider,
          model,
          text: '',
          errorMessage: await extractAiHttpErrorMessage('Gemini', response),
          latencyMs: Date.now() - startedAt,
          keySource
        };
      }

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text =
        data.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? '')
          .join('')
          .trim() ?? '';
      return {
        ok: text.length > 0,
        provider,
        model,
        text,
        errorMessage: text ? null : 'Respuesta vacía de Gemini',
        latencyMs: Date.now() - startedAt,
        keySource
      };
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 512
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        provider,
        model,
        text: '',
        errorMessage: await extractAiHttpErrorMessage('OpenAI', response),
        latencyMs: Date.now() - startedAt,
        keySource
      };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    return {
      ok: text.length > 0,
      provider,
      model,
      text,
      errorMessage: text ? null : 'Respuesta vacía de OpenAI',
      latencyMs: Date.now() - startedAt,
      keySource
    };
  } catch (err) {
    return {
      ok: false,
      provider,
      model,
      text: '',
      errorMessage: err instanceof Error ? err.message : 'Error consultando proveedor IA',
      latencyMs: Date.now() - startedAt,
      keySource
    };
  } finally {
    clearTimeout(timer);
  }
}
