import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Globe, XCircle } from 'lucide-react';
import { FlowHttpExecutionLog } from '@bothub/shared';

interface HttpExecutionDetailsCardProps {
  details: FlowHttpExecutionLog;
  title?: string;
  timestamp?: string;
}

interface HttpStatusBadgeInfo {
  label: string;
  categoryLabel: string;
  badgeClass: string;
}

export function getHttpStatusBadgeInfo(
  statusCode: number | null,
  ok: boolean
): HttpStatusBadgeInfo {
  if (statusCode === null) {
    return {
      label: 'ERROR',
      categoryLabel: 'Sin respuesta HTTP',
      badgeClass: 'border-soft-danger/40 bg-soft-danger/15 text-soft-danger'
    };
  }
  if (statusCode >= 100 && statusCode < 200) {
    return {
      label: `HTTP ${statusCode}`,
      categoryLabel: 'Informativo (1xx)',
      badgeClass: 'border-soft-blue/40 bg-soft-blue/15 text-soft-blue'
    };
  }
  if (statusCode >= 200 && statusCode < 300 && ok) {
    return {
      label: `HTTP ${statusCode}`,
      categoryLabel: 'Éxito (2xx)',
      badgeClass:
        'border-[#82d616]/50 bg-[#82d616]/15 text-[#4b830d] dark:text-[#82d616]'
    };
  }
  if (statusCode >= 300 && statusCode < 400) {
    return {
      label: `HTTP ${statusCode}`,
      categoryLabel: 'Redirección (3xx)',
      badgeClass: 'border-soft-warning/40 bg-soft-warning/15 text-soft-warning'
    };
  }
  return {
    label: `HTTP ${statusCode}`,
    categoryLabel: statusCode >= 500 ? 'Error Servidor (5xx)' : 'Error Cliente (4xx)',
    badgeClass: 'border-soft-danger/40 bg-soft-danger/15 text-soft-danger'
  };
}

function formatPayloadForDisplay(raw: string | null): { text: string; isJson: boolean } {
  if (!raw || raw.trim().length === 0) {
    return { text: '', isJson: false };
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return { text: JSON.stringify(parsed, null, 2), isJson: true };
    } catch {
      return { text: raw, isJson: false };
    }
  }
  return { text: raw, isJson: false };
}

function detectEmptyQueryParams(url: string): string[] {
  try {
    const parsed = new URL(url);
    const emptyKeys: string[] = [];
    for (const [key, value] of parsed.searchParams.entries()) {
      if (value.trim().length === 0) {
        emptyKeys.push(key);
      }
    }
    return emptyKeys;
  } catch {
    return [];
  }
}

function detectArrayHint(responseBody: string): string | null {
  try {
    const parsed = JSON.parse(responseBody.trim()) as unknown;
    if (Array.isArray(parsed)) {
      return 'La respuesta es una lista JSON ([...]). Usa por ejemplo [cedula={{cedula}}].status o [0].status.';
    }
    if (parsed && typeof parsed === 'object') {
      for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(val)) {
          const sampleObj = val.find(
            (item) => item && typeof item === 'object' && !Array.isArray(item)
          ) as Record<string, unknown> | undefined;
          const keys = sampleObj ? Object.keys(sampleObj) : [];
          if (keys.length >= 2) {
            return `"${key}" es una lista con ${val.length} elementos. Prueba "${key}[${keys[0]}={{${keys[0]}}].${keys[1]}" o "${key}[0].${keys[1]}".`;
          }
          return `"${key}" es una lista con ${val.length} elementos. Usa un índice como "${key}[0]" o un filtro como "${key}[campo={{variable}}].propiedad".`;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function HttpExecutionDetailsCard({
  details,
  title,
  timestamp
}: HttpExecutionDetailsCardProps) {
  const statusInfo = getHttpStatusBadgeInfo(details.statusCode, details.ok);
  const formattedResponse = formatPayloadForDisplay(details.responseBody);
  const formattedRequestBody = formatPayloadForDisplay(details.requestBody);
  const emptyQueryParams = detectEmptyQueryParams(details.url);
  const showPathWarning = Boolean(details.responsePath && !details.responsePathMatched);
  const arrayHint = showPathWarning ? detectArrayHint(details.responseBody) : null;

  return (
    <article className="flex flex-col gap-2.5 rounded-xl border border-soft-line bg-soft-bg p-3 text-[11px] text-soft-ink">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-soft-line pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-extrabold ${statusInfo.badgeClass}`}
          >
            {details.ok ? (
              <CheckCircle2 className="h-3 w-3 shrink-0" />
            ) : (
              <XCircle className="h-3 w-3 shrink-0" />
            )}
            <span>{statusInfo.label}</span>
          </span>
          <span className="rounded bg-soft-card px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-soft-blue">
            {details.method}
          </span>
          <span className="text-[10px] font-semibold text-soft-muted">
            {statusInfo.categoryLabel}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-soft-muted">
          <span className="inline-flex items-center gap-1 font-semibold">
            <Clock className="h-3 w-3" />
            <span>{details.durationMs} ms</span>
          </span>
          {timestamp ? (
            <span>
              {new Date(timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })}
            </span>
          ) : null}
        </div>
      </div>

      {title ? (
        <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-soft-ink">
          <Globe className="h-3.5 w-3.5 shrink-0 text-soft-blue" />
          <span className="truncate">{title}</span>
        </div>
      ) : null}

      <details open className="group rounded-lg border border-soft-line bg-soft-card p-2">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-extrabold text-soft-ink [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-soft-blue transition-transform group-open:rotate-90" />
          <span>Qué envió</span>
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <div>
            <span className="block text-[10px] font-bold uppercase text-soft-muted">
              URL final
            </span>
            <code className="mt-0.5 block break-all rounded bg-soft-bg px-2 py-1 font-mono text-[10px] text-soft-ink">
              {details.method} {details.url || '(URL vacía)'}
            </code>
          </div>

          {emptyQueryParams.length > 0 ? (
            <div className="flex items-start gap-1.5 rounded-lg border border-soft-warning/40 bg-soft-warning/10 p-2 text-[10px] font-semibold text-soft-ink">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-soft-warning" />
              <span>
                El parámetro <code>{emptyQueryParams.join(', ')}</code> se envió vacío. Verifica que la variable esté capturada antes de este nodo.
              </span>
            </div>
          ) : null}

          <div>
            <span className="block text-[10px] font-bold uppercase text-soft-muted">
              Headers enviados
            </span>
            <pre className="mt-0.5 max-h-28 overflow-auto rounded bg-soft-bg p-2 font-mono text-[10px] text-soft-ink">
              {JSON.stringify(details.requestHeaders, null, 2)}
            </pre>
          </div>

          <div>
            <span className="block text-[10px] font-bold uppercase text-soft-muted">
              Cuerpo enviado (Body)
            </span>
            {formattedRequestBody.text ? (
              <pre className="mt-0.5 max-h-32 overflow-auto rounded bg-soft-bg p-2 font-mono text-[10px] text-soft-ink">
                {formattedRequestBody.text}
              </pre>
            ) : (
              <p className="mt-0.5 text-[10px] italic text-soft-muted">
                Sin body ({details.method})
              </p>
            )}
          </div>
        </div>
      </details>

      <details open className="group rounded-lg border border-soft-line bg-soft-card p-2">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-extrabold text-soft-ink [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-soft-blue transition-transform group-open:rotate-90" />
          <span>
            Qué recibió ({details.statusCode !== null ? `HTTP ${details.statusCode}` : 'Sin respuesta'})
          </span>
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {details.errorMessage ? (
            <div className="rounded-lg border border-soft-danger/40 bg-soft-danger/10 p-2 text-[10px] font-bold text-soft-danger">
              {details.errorMessage}
            </div>
          ) : null}

          <div>
            <span className="block text-[10px] font-bold uppercase text-soft-muted">
              Cuerpo recibido (Response Body)
            </span>
            <pre className="mt-0.5 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-soft-bg p-2 font-mono text-[10px] text-soft-ink">
              {formattedResponse.text || '(Respuesta vacía)'}
            </pre>
          </div>

          <div className="rounded-lg border border-soft-line bg-soft-bg p-2">
            <div className="flex flex-wrap items-center justify-between gap-1 text-[10px]">
              <span className="font-bold text-soft-muted">
                Variable: <code className="text-soft-blue">{`{{${details.responseVariable}}}`}</code>
              </span>
              {details.responsePath ? (
                <span className="font-mono text-soft-muted">
                  Ruta: <code>{details.responsePath}</code>
                </span>
              ) : null}
            </div>
            <div className="mt-1 break-all font-mono text-[11px] font-bold text-soft-ink">
              {details.extractedValue || '(vacío)'}
            </div>
          </div>

          {showPathWarning ? (
            <div className="flex items-start gap-1.5 rounded-lg border border-soft-warning/40 bg-soft-warning/10 p-2 text-[10px] font-semibold text-soft-ink">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-soft-warning" />
              <div className="flex flex-col gap-1">
                <span>
                  La ruta JSON <code>{details.responsePath}</code> no encontró coincidencia en la respuesta.
                </span>
                {arrayHint ? <span>{arrayHint}</span> : null}
              </div>
            </div>
          ) : null}

          {Object.keys(details.responseHeaders).length > 0 ? (
            <details className="group/hdr rounded border border-soft-line bg-soft-bg p-1.5">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] font-bold text-soft-muted [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open/hdr:rotate-90" />
                <span>Headers recibidos ({Object.keys(details.responseHeaders).length})</span>
              </summary>
              <pre className="mt-1 max-h-28 overflow-auto font-mono text-[10px] text-soft-ink">
                {JSON.stringify(details.responseHeaders, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      </details>
    </article>
  );
}
