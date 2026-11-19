import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, ExternalLink, Trash2 } from 'lucide-react';
import { BotDto, BusinessHoursDay, FlowDto } from '@bothub/shared';
import { botsApi } from '../../lib/api.js';

interface BotScheduleFaqTabProps {
  selectedBot: BotDto;
  flows: FlowDto[];
  onBotUpdated: (bot: BotDto) => void;
  onFeedback: (type: 'ok' | 'err', text: string) => void;
}

const DAY_LABELS: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado'
};

const TIMEZONE_OPTIONS = [
  'America/Bogota',
  'America/Santo_Domingo',
  'America/Mexico_City',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'Europe/Madrid',
  'UTC'
];

export function BotScheduleFaqTab({
  selectedBot,
  flows,
  onBotUpdated,
  onFeedback
}: BotScheduleFaqTabProps) {
  const navigate = useNavigate();
  const [newFaqTitle, setNewFaqTitle] = useState('');
  const [newFaqKeywords, setNewFaqKeywords] = useState('');
  const [newFaqResponse, setNewFaqResponse] = useState('');
  const [newFaqMatchMode, setNewFaqMatchMode] = useState<'CONTAINS' | 'EXACT' | 'REGEX'>('CONTAINS');
  const [businessHoursEnabled, setBusinessHoursEnabled] = useState(
    Boolean(selectedBot.businessHoursEnabled)
  );
  const [timezone, setTimezone] = useState(selectedBot.timezone || 'America/Bogota');
  const [outOfHoursMessage, setOutOfHoursMessage] = useState(
    selectedBot.outOfHoursMessage ||
      'Gracias por comunicarte. En este momento estamos fuera de horario.'
  );
  const [hours, setHours] = useState<BusinessHoursDay[]>(selectedBot.businessHours ?? []);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    setBusinessHoursEnabled(Boolean(selectedBot.businessHoursEnabled));
    setTimezone(selectedBot.timezone || 'America/Bogota');
    setOutOfHoursMessage(
      selectedBot.outOfHoursMessage ||
        'Gracias por comunicarte. En este momento estamos fuera de horario.'
    );
    setHours(selectedBot.businessHours ?? []);
  }, [
    selectedBot.id,
    selectedBot.businessHoursEnabled,
    selectedBot.timezone,
    selectedBot.outOfHoursMessage,
    selectedBot.businessHours
  ]);

  async function handleAssignFlow(flowId: string): Promise<void> {
    setIsBusy(true);
    try {
      const { bot } = await botsApi.update(selectedBot.id, {
        activeFlowId: flowId || null
      });
      onBotUpdated(bot);
      onFeedback(
        'ok',
        `Flujo "${bot.activeFlowName ?? 'Ninguno'}" asignado a ${bot.name}.`
      );
    } catch (err) {
      onFeedback(
        'err',
        err instanceof Error ? err.message : 'No se pudo asignar el flujo al bot.'
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSaveSchedule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsBusy(true);
    try {
      const { bot } = await botsApi.update(selectedBot.id, {
        businessHoursEnabled,
        timezone,
        outOfHoursMessage: outOfHoursMessage.trim(),
        businessHours: hours
      });
      onBotUpdated(bot);
      onFeedback('ok', `Horario y zona horaria actualizados para ${bot.name}.`);
    } catch (err) {
      onFeedback(
        'err',
        err instanceof Error ? err.message : 'No se pudo guardar el horario de atención.'
      );
    } finally {
      setIsBusy(false);
    }
  }

  function updateDaySchedule(
    dayOfWeek: number,
    patch: Partial<BusinessHoursDay>
  ): void {
    setHours((prev) =>
      prev.map((day) =>
        day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day
      )
    );
  }

  async function handleAddQuickReply(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!newFaqTitle.trim() || !newFaqResponse.trim()) return;
    setIsBusy(true);
    try {
      const keywords = newFaqKeywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      const updatedReplies = [
        ...selectedBot.quickReplies,
        {
          id: `qr-${Date.now()}`,
          title: newFaqTitle.trim(),
          keywords: keywords.length > 0 ? keywords : [newFaqTitle.toLowerCase()],
          responseText: newFaqResponse.trim(),
          matchMode: newFaqMatchMode,
          isActive: true
        }
      ];
      const { bot } = await botsApi.update(selectedBot.id, {
        quickReplies: updatedReplies
      });
      onBotUpdated(bot);
      setNewFaqTitle('');
      setNewFaqKeywords('');
      setNewFaqResponse('');
      onFeedback('ok', 'Respuesta rápida agregada al bot.');
    } catch (err) {
      onFeedback(
        'err',
        err instanceof Error ? err.message : 'No se pudo agregar la respuesta rápida.'
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleToggleQuickReply(faqId: string): Promise<void> {
    setIsBusy(true);
    try {
      const updatedReplies = selectedBot.quickReplies.map((item) =>
        item.id === faqId ? { ...item, isActive: !item.isActive } : item
      );
      const { bot } = await botsApi.update(selectedBot.id, {
        quickReplies: updatedReplies
      });
      onBotUpdated(bot);
    } catch (err) {
      onFeedback(
        'err',
        err instanceof Error ? err.message : 'No se pudo actualizar la FAQ.'
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteQuickReply(faqId: string): Promise<void> {
    setIsBusy(true);
    try {
      const updatedReplies = selectedBot.quickReplies.filter((item) => item.id !== faqId);
      const { bot } = await botsApi.update(selectedBot.id, {
        quickReplies: updatedReplies
      });
      onBotUpdated(bot);
      onFeedback('ok', 'Respuesta rápida eliminada.');
    } catch (err) {
      onFeedback(
        'err',
        err instanceof Error ? err.message : 'No se pudo eliminar la FAQ.'
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 rounded-2xl border border-soft-line bg-soft-bg p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-soft-blue">
              Flujo Visual Conectado al Bot
            </span>
            <button
              type="button"
              onClick={() => navigate('/flows')}
              className="inline-flex min-h-[36px] items-center gap-1 text-xs font-extrabold text-soft-blue hover:underline"
            >
              <span>Abrir Editor Visual React Flow</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>

          <div>
            <label
              htmlFor="assign-flow-select"
              className="mb-1.5 block text-xs font-bold text-soft-ink"
            >
              Seleccionar Flujo Principal para {selectedBot.name}
            </label>
            <select
              id="assign-flow-select"
              name="activeFlowId"
              disabled={isBusy}
              value={selectedBot.activeFlowId ?? ''}
              onChange={(e) => void handleAssignFlow(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-card px-3.5 py-2.5 text-xs font-bold text-soft-ink"
            >
              <option value="">Sin flujo asignado</option>
              {flows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.name} (v{flow.activeVersionNumber})
                </option>
              ))}
            </select>
          </div>
        </div>

        <form
          onSubmit={handleSaveSchedule}
          className="flex flex-col gap-4 rounded-2xl border border-soft-line bg-soft-bg p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-soft-blue">
              <Clock className="h-3.5 w-3.5" />
              Horario de Atención y Zona Horaria
            </span>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-soft-ink">
              <input
                type="checkbox"
                checked={businessHoursEnabled}
                onChange={(e) => setBusinessHoursEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-soft-line accent-soft-blue"
              />
              <span>Aplicar horario en webhook</span>
            </label>
          </div>

          <div>
            <label
              htmlFor="bot-timezone-select"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Zona Horaria (IANA)
            </label>
            <select
              id="bot-timezone-select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs font-semibold text-soft-ink"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="bot-out-of-hours-msg"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Mensaje fuera de horario
            </label>
            <textarea
              id="bot-out-of-hours-msg"
              rows={2}
              value={outOfHoursMessage}
              onChange={(e) => setOutOfHoursMessage(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs text-soft-ink"
            />
          </div>

          <div className="flex flex-col gap-2">
            {hours.map((day) => (
              <div
                key={day.dayOfWeek}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs"
              >
                <label className="inline-flex min-w-[105px] cursor-pointer items-center gap-2 font-bold text-soft-ink">
                  <input
                    type="checkbox"
                    checked={day.isOpen}
                    onChange={(e) =>
                      updateDaySchedule(day.dayOfWeek, { isOpen: e.target.checked })
                    }
                    className="h-4 w-4 accent-soft-blue"
                  />
                  <span>{DAY_LABELS[day.dayOfWeek] ?? `Día ${day.dayOfWeek}`}</span>
                </label>

                {day.isOpen ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      aria-label={`Apertura ${DAY_LABELS[day.dayOfWeek]}`}
                      value={day.openTime}
                      onChange={(e) =>
                        updateDaySchedule(day.dayOfWeek, { openTime: e.target.value })
                      }
                      className="rounded-lg border border-soft-line bg-soft-bg px-2 py-1 text-[11px] font-semibold text-soft-ink"
                    />
                    <span className="text-soft-muted">a</span>
                    <input
                      type="time"
                      aria-label={`Cierre ${DAY_LABELS[day.dayOfWeek]}`}
                      value={day.closeTime}
                      onChange={(e) =>
                        updateDaySchedule(day.dayOfWeek, { closeTime: e.target.value })
                      }
                      className="rounded-lg border border-soft-line bg-soft-bg px-2 py-1 text-[11px] font-semibold text-soft-ink"
                    />
                  </div>
                ) : (
                  <span className="text-[11px] font-bold text-soft-muted">Cerrado</span>
                )}
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={isBusy}
            className="min-h-[40px] rounded-xl bg-brand-gradient py-2 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
          >
            Guardar Horario y Reglas
          </button>
        </form>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-soft-line bg-soft-bg p-5">
        <span className="text-xs font-extrabold uppercase tracking-wider text-soft-blue">
          Respuestas Rápidas Automáticas (FAQ)
        </span>
        <form onSubmit={handleAddQuickReply} className="grid grid-cols-1 gap-2.5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label
                htmlFor="faq-title"
                className="mb-1 block text-[11px] font-bold text-soft-ink"
              >
                Título FAQ
              </label>
              <input
                id="faq-title"
                name="title"
                type="text"
                required
                placeholder="Ej: Medios de Pago"
                value={newFaqTitle}
                onChange={(e) => setNewFaqTitle(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs text-soft-ink"
              />
            </div>
            <div>
              <label
                htmlFor="faq-keywords"
                className="mb-1 block text-[11px] font-bold text-soft-ink"
              >
                Palabras clave (coma)
              </label>
              <input
                id="faq-keywords"
                name="keywords"
                type="text"
                required
                placeholder="pago, nequi, pse"
                value={newFaqKeywords}
                onChange={(e) => setNewFaqKeywords(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs text-soft-ink"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px]">
            <div>
              <label
                htmlFor="faq-response"
                className="mb-1 block text-[11px] font-bold text-soft-ink"
              >
                Respuesta automática
              </label>
              <input
                id="faq-response"
                name="responseText"
                type="text"
                required
                placeholder="Aceptamos PSE, tarjetas y transferencias."
                value={newFaqResponse}
                onChange={(e) => setNewFaqResponse(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs text-soft-ink"
              />
            </div>
            <div>
              <label
                htmlFor="faq-match-mode"
                className="mb-1 block text-[11px] font-bold text-soft-ink"
              >
                Coincidencia
              </label>
              <select
                id="faq-match-mode"
                value={newFaqMatchMode}
                onChange={(e) =>
                  setNewFaqMatchMode(e.target.value as 'CONTAINS' | 'EXACT' | 'REGEX')
                }
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs font-bold text-soft-ink"
              >
                <option value="CONTAINS">CONTAINS</option>
                <option value="EXACT">EXACT</option>
                <option value="REGEX">REGEX</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={isBusy}
            className="min-h-[40px] rounded-xl bg-brand-gradient py-2 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
          >
            + Agregar Respuesta Rápida
          </button>
        </form>

        <div className="mt-2 flex flex-col gap-2.5">
          {selectedBot.quickReplies.length === 0 ? (
            <div className="rounded-xl border border-dashed border-soft-line bg-soft-card p-4 text-center text-xs text-soft-muted">
              Aún no hay respuestas rápidas configuradas para este bot.
            </div>
          ) : (
            selectedBot.quickReplies.map((faq) => (
              <div
                key={faq.id}
                className="flex flex-col gap-2 rounded-xl border border-soft-line bg-soft-card p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-bold text-soft-ink">{faq.title}</span>
                      <span className="rounded bg-soft-bg px-1.5 py-0.5 text-[10px] font-bold text-soft-blue">
                        {faq.matchMode}
                      </span>
                    </div>
                    <p className="m-0 mt-1 text-xs text-soft-muted">{faq.responseText}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {faq.keywords.map((kw, idx) => (
                        <span
                          key={`${faq.id}-kw-${idx}`}
                          className="rounded-md border border-soft-line bg-soft-bg px-2 py-0.5 text-[10px] font-semibold text-soft-ink"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleToggleQuickReply(faq.id)}
                      className="min-h-[36px] rounded-lg border border-soft-line bg-soft-bg px-2.5 py-1 text-[10px] font-extrabold text-soft-ink"
                    >
                      {faq.isActive ? 'Activa' : 'Inactiva'}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      aria-label={`Eliminar FAQ ${faq.title}`}
                      onClick={() => void handleDeleteQuickReply(faq.id)}
                      className="grid min-h-[36px] min-w-[36px] place-items-center rounded-lg border border-soft-line bg-soft-bg text-soft-danger hover:border-soft-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
