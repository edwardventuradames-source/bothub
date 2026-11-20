import { FormEvent, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  GitBranch,
  Pencil,
  Plus,
  Search,
  Trash2
} from 'lucide-react';
import { BotDto, FlowDto } from '@bothub/shared';

interface FlowsCatalogViewProps {
  flows: FlowDto[];
  bots: BotDto[];
  isLoading: boolean;
  canEditFlows: boolean;
  isUpdatingBot: boolean;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  botFilterId: string;
  onBotFilterChange: (value: string) => void;
  feedback: { type: 'ok' | 'err'; text: string } | null;
  onDismissFeedback: () => void;
  onClearFilters: () => void;
  onOpenCreateDialog: () => void;
  onRequestDeleteFlow: (flow: FlowDto) => void;
  onAssignBot: (flowId: string, botId: string | null) => Promise<boolean>;
}

function formatFlowUpdatedAt(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return 'Reciente';
  return parsed
    .toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
    .replace(' de ', ' ');
}

export function FlowsCatalogView({
  flows,
  bots,
  isLoading,
  canEditFlows,
  isUpdatingBot,
  searchQuery,
  onSearchQueryChange,
  botFilterId,
  onBotFilterChange,
  feedback,
  onDismissFeedback,
  onClearFilters,
  onOpenCreateDialog,
  onRequestDeleteFlow,
  onAssignBot
}: FlowsCatalogViewProps) {
  const searchInputId = useId();
  const botSelectId = useId();
  const [editingBotFlowId, setEditingBotFlowId] = useState<string | null>(null);
  const [draftBotId, setDraftBotId] = useState<string>('');

  async function handleCardBotSubmit(
    event: FormEvent<HTMLFormElement>,
    flowId: string
  ): Promise<void> {
    event.preventDefault();
    const ok = await onAssignBot(flowId, draftBotId || null);
    if (ok) {
      setEditingBotFlowId(null);
    }
  }

  const filteredFlows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return flows.filter((flow) => {
      if (botFilterId === 'UNASSIGNED' && flow.botId !== null) {
        return false;
      }
      if (botFilterId !== 'ALL' && botFilterId !== 'UNASSIGNED' && flow.botId !== botFilterId) {
        return false;
      }
      if (!query) return true;
      return (
        flow.name.toLowerCase().includes(query) ||
        flow.description.toLowerCase().includes(query) ||
        (flow.botName ?? '').toLowerCase().includes(query)
      );
    });
  }, [flows, botFilterId, searchQuery]);

  const hasActiveFilters = Boolean(searchQuery.trim()) || botFilterId !== 'ALL';

  return (
    <div className="flex flex-col gap-5">
      <section className="soft-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-gradient text-white shadow-brand-icon">
            <GitBranch className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-extrabold text-soft-ink">
                Flujos Conversacionales
              </h1>
              <span className="rounded-full bg-soft-blue/10 px-2.5 py-0.5 text-[11px] font-extrabold text-soft-blue">
                {filteredFlows.length}
              </span>
            </div>
            <p className="text-xs text-soft-muted">
              Visualiza todos tus flujos en tarjetas y selecciona cualquiera para editar sus nodos en el lienzo.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <label htmlFor={searchInputId} className="sr-only">
              Buscar flujos por nombre o bot
            </label>
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-soft-muted" />
            <input
              id={searchInputId}
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Buscar flujo o bot..."
              className="min-h-[40px] w-full rounded-xl border border-soft-line bg-soft-bg pr-3 pl-9 text-xs font-semibold text-soft-ink placeholder:text-soft-muted"
            />
          </div>

          <div>
            <label htmlFor={botSelectId} className="sr-only">
              Filtrar por bot asignado
            </label>
            <select
              id={botSelectId}
              value={botFilterId}
              onChange={(e) => onBotFilterChange(e.target.value)}
              className="min-h-[40px] rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-xs font-bold text-soft-ink"
            >
              <option value="ALL">Todos los bots</option>
              <option value="UNASSIGNED">Sin bot asignado</option>
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name}
                </option>
              ))}
            </select>
          </div>

          {canEditFlows ? (
            <button
              type="button"
              onClick={onOpenCreateDialog}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-brand-gradient px-4 py-2 text-xs font-extrabold text-white shadow-brand-icon"
            >
              <Plus className="h-4 w-4" />
              <span>Nuevo Flujo</span>
            </button>
          ) : null}
        </div>
      </section>

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
            onClick={onDismissFeedback}
            className="text-xs underline"
          >
            Ocultar
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <div className="soft-card grid min-h-[220px] place-items-center p-8 text-xs font-bold text-soft-muted">
          Cargando catálogo de flujos...
        </div>
      ) : flows.length === 0 ? (
        <div className="soft-card flex flex-col items-center justify-center gap-3 p-10 text-center">
          <GitBranch className="h-8 w-8 text-soft-blue" />
          <h2 className="text-base font-extrabold text-soft-ink">
            Aún no hay flujos creados
          </h2>
          <p className="max-w-md text-xs text-soft-muted">
            Crea un nuevo flujo conversacional para arrastrar disparadores, preguntas validadas, peticiones HTTP y handoff hacia Chatwoot.
          </p>
          {canEditFlows ? (
            <button
              type="button"
              onClick={onOpenCreateDialog}
              className="mt-1 min-h-[44px] rounded-xl bg-brand-gradient px-5 py-2.5 text-xs font-extrabold text-white shadow-brand-icon"
            >
              + Crear Mi Primer Flujo
            </button>
          ) : null}
        </div>
      ) : filteredFlows.length === 0 ? (
        <div className="soft-card flex flex-wrap items-center justify-between gap-4 p-8">
          <div>
            <h2 className="text-base font-extrabold text-soft-ink">
              Sin flujos para el filtro seleccionado
            </h2>
            <p className="mt-1 text-xs text-soft-muted">
              Ajusta tu búsqueda o cambia el bot seleccionado para ver los demás flujos.
            </p>
          </div>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={onClearFilters}
              className="min-h-[40px] rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-extrabold text-soft-ink hover:border-soft-blue"
            >
              Limpiar filtros
            </button>
          ) : null}
        </div>
      ) : (
        <ul role="list" className="flow-cards-grid">
          {filteredFlows.map((flow) => {
            const isPublished = Boolean(flow.publishedVersion);
            const nodeCount = flow.draftVersion.nodes.length;
            const edgeCount = flow.draftVersion.edges.length;

            return (
              <li key={flow.id} className="flow-card-slot">
                <article className="flow-card soft-card min-w-0 p-5">
                  <header className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-gradient text-white shadow-brand-icon">
                        <GitBranch className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-sm font-extrabold text-soft-ink">
                          <Link
                            to={`/flows/${flow.id}`}
                            className="flow-card-link hover:text-soft-blue"
                          >
                            {flow.name}
                          </Link>
                        </h2>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-soft-muted">
                          <span>v{flow.activeVersionNumber}</span>
                          {flow.isMainMenu ? (
                            <span className="rounded-md bg-soft-blue/10 px-1.5 py-0.5 text-[10px] font-extrabold text-soft-blue">
                              Menú Principal
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase ${
                        isPublished
                          ? 'bg-[#82d616]/15 text-[#4b830d] dark:text-[#82d616]'
                          : 'bg-soft-warning/15 text-soft-warning'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isPublished ? 'bg-[#82d616]' : 'bg-soft-warning'
                        }`}
                      />
                      {isPublished ? 'Publicado' : 'Borrador'}
                    </span>
                  </header>

                  <p className="line-clamp-2 text-xs text-soft-muted">
                    {flow.description}
                  </p>

                  <div className="flex flex-col gap-2.5 self-end">
                    {canEditFlows && editingBotFlowId === flow.id ? (
                      <form
                        onSubmit={(e) => void handleCardBotSubmit(e, flow.id)}
                        className="flex flex-wrap items-center gap-1.5"
                      >
                        <label htmlFor={`card-bot-${flow.id}`} className="sr-only">
                          Bot asignado a {flow.name}
                        </label>
                        <select
                          id={`card-bot-${flow.id}`}
                          value={draftBotId}
                          disabled={isUpdatingBot}
                          onChange={(e) => setDraftBotId(e.target.value)}
                          className="min-h-[36px] min-w-0 flex-1 rounded-lg border border-soft-blue bg-soft-bg px-2.5 py-1 text-[11px] font-bold text-soft-ink"
                        >
                          <option value="">Sin bot asignado</option>
                          {bots.map((bot) => (
                            <option key={bot.id} value={bot.id}>
                              {bot.name} ({bot.phoneNumber || bot.driver})
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          disabled={isUpdatingBot}
                          className="min-h-[36px] rounded-lg bg-brand-gradient px-2.5 py-1 text-[11px] font-extrabold text-white disabled:opacity-60"
                        >
                          {isUpdatingBot ? '...' : 'Guardar'}
                        </button>
                        <button
                          type="button"
                          disabled={isUpdatingBot}
                          onClick={() => setEditingBotFlowId(null)}
                          className="min-h-[36px] rounded-lg border border-soft-line bg-soft-bg px-2 py-1 text-[11px] font-bold text-soft-muted hover:text-soft-ink"
                        >
                          Cancelar
                        </button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-soft-line bg-soft-bg px-2.5 py-1 text-[11px] font-bold text-soft-ink">
                          <Bot className="h-3.5 w-3.5 shrink-0 text-soft-blue" />
                          <span className="truncate">
                            {flow.botName ? `Bot: ${flow.botName}` : 'Sin bot asignado'}
                          </span>
                        </div>
                        {canEditFlows ? (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBotFlowId(flow.id);
                              setDraftBotId(flow.botId ?? '');
                            }}
                            aria-label={`Cambiar bot de ${flow.name}`}
                            className="inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-lg border border-soft-line bg-soft-bg px-2 py-0.5 text-[11px] font-bold text-soft-blue hover:border-soft-blue"
                          >
                            <Pencil className="h-3 w-3" />
                            <span>Cambiar bot</span>
                          </button>
                        ) : null}
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-2 rounded-xl bg-soft-bg p-2.5 text-center">
                      <div>
                        <div className="text-[10px] font-bold uppercase text-soft-muted">
                          Nodos
                        </div>
                        <div className="mt-0.5 text-xs font-extrabold text-soft-ink">
                          {nodeCount}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase text-soft-muted">
                          Líneas
                        </div>
                        <div className="mt-0.5 text-xs font-extrabold text-soft-ink">
                          {edgeCount}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase text-soft-muted">
                          Editado
                        </div>
                        <div className="mt-0.5 truncate text-[11px] font-extrabold text-soft-ink">
                          {formatFlowUpdatedAt(flow.updatedAt)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <footer className="flex items-center justify-between gap-2 border-t border-soft-line pt-3">
                    <span className="inline-flex items-center gap-1 text-xs font-extrabold text-soft-blue">
                      <span>Abrir editor</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </span>

                    {canEditFlows ? (
                      <button
                        type="button"
                        onClick={() => onRequestDeleteFlow(flow)}
                        aria-label={`Eliminar flujo ${flow.name}`}
                        className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center gap-1 rounded-xl border border-soft-line bg-soft-bg px-2.5 py-1 text-xs font-bold text-soft-danger hover:border-soft-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="sr-only sm:not-sr-only">Eliminar</span>
                      </button>
                    ) : null}
                  </footer>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
