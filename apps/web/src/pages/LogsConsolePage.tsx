import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { RefreshCw, Terminal } from 'lucide-react';
import { BotLogDto } from '@bothub/shared';
import { platformApi } from '../lib/api.js';
import { createAuthenticatedSocket } from '../lib/socket.js';
import { useAuthStore } from '../store/auth.store.js';

export function LogsConsolePage() {
  const outletContext = useOutletContext<{ searchQuery?: string } | null>();
  const searchQuery = outletContext?.searchQuery ?? '';
  const accessToken = useAuthStore((s) => s.accessToken);

  const [logs, setLogs] = useState<BotLogDto[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>('ALL');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const fetchLogs = useCallback(async (level: string): Promise<void> => {
    setIsRefreshing(true);
    try {
      const res = await platformApi.listLogs({ level });
      setLogs(res.logs);
      setErrorBanner(null);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'No se pudieron consultar los logs.'
      );
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchLogs(levelFilter);
  }, [levelFilter, fetchLogs]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    const socket = createAuthenticatedSocket();
    if (!socket) {
      return;
    }

    socket.on('log:new', (entry: BotLogDto) => {
      if (levelFilter !== 'ALL' && entry.level !== levelFilter) {
        return;
      }
      setLogs((prev) => [entry, ...prev].slice(0, 200));
    });

    return () => {
      socket.disconnect();
    };
  }, [accessToken, levelFilter]);

  const filteredLogs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return logs;
    return logs.filter(
      (entry) =>
        entry.botName.toLowerCase().includes(query) ||
        entry.event.toLowerCase().includes(query) ||
        entry.message.toLowerCase().includes(query)
    );
  }, [logs, searchQuery]);

  return (
    <div className="flex flex-col gap-5">
      <section className="soft-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-soft-blue/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
            <Terminal className="h-3.5 w-3.5" />
            <span>Observabilidad Pino + Socket.IO</span>
          </span>
          <h1 className="mt-1.5 text-xl font-extrabold text-soft-ink">
            Consola de Logs y Eventos en Tiempo Real ({filteredLogs.length})
          </h1>
          <p className="mt-0.5 text-xs text-soft-muted">
            Auditoría estructurada de sesiones WhatsApp, ejecución de nodos, peticiones HTTP y webhooks de Chatwoot.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {['ALL', 'INFO', 'WARN', 'ERROR', 'DEBUG'].map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setLevelFilter(lvl)}
              className={`min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-extrabold ${
                levelFilter === lvl
                  ? 'bg-brand-gradient text-white shadow-brand-icon'
                  : 'bg-soft-bg text-soft-ink'
              }`}
            >
              {lvl}
            </button>
          ))}

          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => void fetchLogs(levelFilter)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-3.5 py-1.5 text-xs font-extrabold text-soft-ink hover:border-soft-blue disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </div>
      </section>

      {errorBanner ? (
        <div
          role="alert"
          className="rounded-2xl border border-soft-danger/40 bg-soft-danger/15 px-4 py-2.5 text-xs font-bold text-soft-danger"
        >
          {errorBanner}
        </div>
      ) : null}

      <section className="soft-card overflow-hidden p-5">
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Terminal className="h-7 w-7 text-soft-blue" />
            <p className="m-0 text-xs font-bold text-soft-ink">
              Sin registros de eventos para el filtro seleccionado.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 font-mono text-xs">
            {filteredLogs.map((entry) => {
              const isWarn = entry.level === 'WARN';
              const isErr = entry.level === 'ERROR';

              return (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-soft-line bg-soft-bg px-4 py-3"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold ${
                        isErr
                          ? 'bg-soft-danger/20 text-soft-danger'
                          : isWarn
                            ? 'bg-soft-warning/20 text-soft-warning'
                            : 'bg-soft-blue/15 text-soft-blue'
                      }`}
                    >
                      {entry.level}
                    </span>
                    <strong className="text-soft-ink">[{entry.botName}]</strong>
                    <span className="rounded bg-soft-card px-2 py-0.5 text-[11px] font-bold text-soft-blue">
                      {entry.event}
                    </span>
                    <span className="break-words font-sans text-soft-ink">
                      {entry.message}
                    </span>
                  </div>

                  <span className="shrink-0 text-[11px] text-soft-muted">
                    {new Date(entry.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
