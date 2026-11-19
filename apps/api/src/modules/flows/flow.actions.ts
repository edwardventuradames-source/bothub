import { FlowNode } from '@bothub/shared';

const ACTION_HTTP_TIMEOUT_MS = 8000;
const MAX_RESPONSE_PREVIEW_CHARS = 1200;

function isBlockedPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower === '0.0.0.0' ||
    lower === '169.254.169.254' ||
    lower === 'metadata.google.internal' ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return false;
  }

  const a = Number(ipv4Match[1]);
  const b = Number(ipv4Match[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function interpolateTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, varName: string) => {
    const value = variables[varName];
    return typeof value === 'string' && value.length > 0 ? value : '';
  });
}

function extractJsonPathValue(payload: unknown, pathExpr: string): string {
  const segments = pathExpr.split('.').map((s) => s.trim()).filter(Boolean);
  let cursor: unknown = payload;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') {
      return '';
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  if (cursor === null || cursor === undefined) {
    return '';
  }
  return typeof cursor === 'string' ? cursor : JSON.stringify(cursor);
}

export async function executeHttpRequestNode(
  node: FlowNode,
  variables: Record<string, string>
): Promise<{
  ok: boolean;
  renderedUrl: string;
  method: string;
  statusCode: number | null;
  value: string;
  errorMessage: string | null;
}> {
  const rawUrl = String(node.data.url ?? '').trim();
  const method = String(node.data.method ?? 'GET').toUpperCase();
  const renderedUrl = interpolateTemplate(rawUrl, variables);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(renderedUrl);
  } catch {
    return {
      ok: false,
      renderedUrl,
      method,
      statusCode: null,
      value: '',
      errorMessage: `URL inválida en nodo HTTP: "${renderedUrl}"`
    };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      ok: false,
      renderedUrl,
      method,
      statusCode: null,
      value: '',
      errorMessage: `Protocolo no permitido: ${parsedUrl.protocol}`
    };
  }

  if (isBlockedPrivateHost(parsedUrl.hostname)) {
    return {
      ok: false,
      renderedUrl,
      method,
      statusCode: null,
      value: '',
      errorMessage: `Host bloqueado por política de seguridad SSRF: ${parsedUrl.hostname}`
    };
  }

  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain'
  };
  if (node.data.headers && typeof node.data.headers === 'object') {
    for (const [key, val] of Object.entries(node.data.headers as Record<string, unknown>)) {
      if (typeof val === 'string') {
        headers[key] = interpolateTemplate(val, variables);
      }
    }
  }

  const rawBody = typeof node.data.bodyTemplate === 'string' ? node.data.bodyTemplate : '';
  const hasBody = !['GET', 'HEAD'].includes(method) && rawBody.trim().length > 0;
  if (hasBody && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACTION_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(parsedUrl.toString(), {
      method,
      headers,
      body: hasBody ? interpolateTemplate(rawBody, variables) : undefined,
      signal: controller.signal
    });

    const rawText = await response.text();
    let extractedValue = rawText.slice(0, MAX_RESPONSE_PREVIEW_CHARS);

    const jsonPath = typeof node.data.responsePath === 'string' ? node.data.responsePath.trim() : '';
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json') || rawText.trim().startsWith('{')) {
      try {
        const parsedJson = JSON.parse(rawText) as unknown;
        if (jsonPath) {
          extractedValue = extractJsonPathValue(parsedJson, jsonPath);
        } else {
          extractedValue = JSON.stringify(parsedJson).slice(0, MAX_RESPONSE_PREVIEW_CHARS);
        }
      } catch {
        void 0;
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        renderedUrl,
        method,
        statusCode: response.status,
        value: extractedValue,
        errorMessage: `HTTP ${response.status} al consultar ${parsedUrl.hostname}`
      };
    }

    return {
      ok: true,
      renderedUrl,
      method,
      statusCode: response.status,
      value: extractedValue,
      errorMessage: null
    };
  } catch (err) {
    return {
      ok: false,
      renderedUrl,
      method,
      statusCode: null,
      value: '',
      errorMessage: err instanceof Error ? err.message : 'Error de red en petición HTTP'
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeAiPromptNode(
  node: FlowNode,
  variables: Record<string, string>,
  latestInput: string
): Promise<{
  ok: boolean;
  model: string;
  text: string;
  errorMessage: string | null;
}> {
  const model = String(node.data.model ?? 'gpt-4o-mini').trim();
  const rawSystemPrompt = String(
    node.data.systemPrompt ?? 'Eres un asistente útil y amable.'
  );
  const systemPrompt = interpolateTemplate(rawSystemPrompt, variables);
  const userMessage = latestInput.trim() || variables.ultimo_mensaje || '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACTION_HTTP_TIMEOUT_MS);

  try {
    if (model.startsWith('claude')) {
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey) {
        return {
          ok: false,
          model,
          text: '',
          errorMessage: 'ANTHROPIC_API_KEY no está configurada en el servidor.'
        };
      }

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
          model,
          text: '',
          errorMessage: `Anthropic API HTTP ${response.status}`
        };
      }

      const data = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = data.content?.find((c) => c.type === 'text')?.text?.trim() ?? '';
      return { ok: text.length > 0, model, text, errorMessage: text ? null : 'Respuesta vacía de Anthropic' };
    }

    if (model.startsWith('gemini')) {
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey) {
        return {
          ok: false,
          model,
          text: '',
          errorMessage: 'GEMINI_API_KEY no está configurada en el servidor.'
        };
      }

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
          model,
          text: '',
          errorMessage: `Gemini API HTTP ${response.status}`
        };
      }

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
      return { ok: text.length > 0, model, text, errorMessage: text ? null : 'Respuesta vacía de Gemini' };
    }

    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    if (!openaiKey) {
      return {
        ok: false,
        model,
        text: '',
        errorMessage: 'OPENAI_API_KEY no está configurada en el servidor.'
      };
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`
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
        model,
        text: '',
        errorMessage: `OpenAI API HTTP ${response.status}`
      };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    return { ok: text.length > 0, model, text, errorMessage: text ? null : 'Respuesta vacía de OpenAI' };
  } catch (err) {
    return {
      ok: false,
      model,
      text: '',
      errorMessage: err instanceof Error ? err.message : 'Error consultando proveedor IA'
    };
  } finally {
    clearTimeout(timer);
  }
}
