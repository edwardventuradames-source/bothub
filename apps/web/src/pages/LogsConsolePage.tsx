import { useEffect, useState } from 'react';
import { RefreshCw, Terminal } from 'lucide-react';
import { BotLogDto } from '@bothub/shared';
import { platformApi } from '../lib/api.js';

export function LogsConsolePage() {
  const [logs, setLogs] = useState<BotLogDto[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>('ALL');
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function fetchLogs(level = levelFilter): Promise<void> {
    setIsRefreshing(true);
    try {
      const res = await platformApi.listLogs({ level });
      setLogs(res.logs);
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void fetchLogs(levelFilter);
  }, [levelFilter]);

  return (
    <div className="flex flex-col gap-5">
      <section className="soft-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-soft-blue/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
            <Terminal className="h-3.5 w-3.5" />
            <span>Observabilidad Pino + Socket.IO</span>
          </span>
          <h1 className="mt-1.5 text-xl font-extrabold text-soft-ink">
            Consola de Logs y Eventos en Tiempo Real ({logs.length})
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
              className={`rounded-xl px-3 py-1.5 text-xs font-extrabold ${
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
            onClick={() => void fetchLogs(levelFilter)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-3.5 py-1.5 text-xs font-extrabold text-soft-ink hover:border-soft-blue"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </div>
      </section>

      <section className="soft-card overflow-hidden p-5">
        <div className="flex flex-col gap-2.5 font-mono text-xs">
          {logs.map((entry) => {
            const isWarn = entry.level === 'WARN';
            const isErr = entry.level === 'ERROR';

            return (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-soft-line bg-soft-bg px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold ${
                      isErr
                        ? 'bg-soft-danger/20 text-soft-danger'
                        : isWarn
                          ? 'bg-soft-warn/20 text-soft-warn'
                          : 'bg-soft-blue/15 text-soft-blue'
                    }`}
                  >
                    {entry.level}
                  </span>
                  <strong className="text-soft-ink">[{entry.botName}]</strong>
                  <span className="rounded bg-soft-card px-2 py-0.5 text-[11px] font-bold text-soft-blue">
                    {entry.event}
                  </span>
                  <span className="font-sans text-soft-ink">{entry.message}</span>
                </div>

                <span className="text-[11px] text-soft-muted">
                  {new Date(entry.createdAt).toLocaleTimeString()}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
