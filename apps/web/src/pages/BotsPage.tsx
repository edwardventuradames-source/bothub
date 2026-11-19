import { FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Bot,
  Copy,
  Pause,
  Play,
  Plus,
  Trash2,
  WifiOff
} from 'lucide-react';
import {
  BotDto,
  FlowDto,
  WhatsAppDriverType,
  WhatsAppQrEvent,
  WhatsAppStatusEvent
} from '@bothub/shared';
import { botsApi, flowsApi } from '../lib/api.js';
import { createAuthenticatedSocket } from '../lib/socket.js';
import { BotConfigTabs } from '../components/bots/BotConfigTabs.js';
import { useAuthStore } from '../store/auth.store.js';

export function BotsPage() {
  const outletContext = useOutletContext<{ searchQuery?: string } | null>();
  const searchQuery = outletContext?.searchQuery ?? '';
  const createDialogTitleId = useId();
  const deleteDialogTitleId = useId();
  const createDialogRef = useRef<HTMLDialogElement | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);

  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const canOperateBots = user?.role === 'ADMIN' || user?.role === 'OPERATOR';
  const isAdmin = user?.role === 'ADMIN';

  const [bots, setBots] = useState<BotDto[]>([]);
  const [flows, setFlows] = useState<FlowDto[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [deleteTargetBot, setDeleteTargetBot] = useState<BotDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyBotId, setBusyBotId] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const [newBotName, setNewBotName] = useState('');
  const [newBotPhone, setNewBotPhone] = useState('');
  const [newBotDescription, setNewBotDescription] = useState('');
  const [newBotDriver, setNewBotDriver] = useState<WhatsAppDriverType>('CHATWOOT');
  const [newBotFlowId, setNewBotFlowId] = useState<string>('');

  const filteredBots = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return bots;
    return bots.filter(
      (bot) =>
        bot.name.toLowerCase().includes(query) ||
        bot.phoneNumber.toLowerCase().includes(query) ||
        bot.driver.toLowerCase().includes(query) ||
        (bot.activeFlowName ?? '').toLowerCase().includes(query)
    );
  }, [bots, searchQuery]);

  const selectedBot =
    filteredBots.find((b) => b.id === selectedBotId) ??
    filteredBots[0] ??
    bots.find((b) => b.id === selectedBotId) ??
    null;

  useEffect(() => {
    async function loadBotsAndFlows(): Promise<void> {
      setIsLoading(true);
      try {
        const [botsRes, flowsRes] = await Promise.all([
          botsApi.list(),
          flowsApi.list()
        ]);
        setBots(botsRes.bots);
        setFlows(flowsRes.flows);
        if (botsRes.bots[0]) {
          setSelectedBotId(botsRes.bots[0].id);
        }
        if (flowsRes.flows[0]) {
          setNewBotFlowId(flowsRes.flows[0].id);
        }
      } catch (err) {
        setFeedbackBanner({
          type: 'err',
          text:
            err instanceof Error
              ? err.message
              : 'No se pudo cargar la lista de bots y flujos.'
        });
      } finally {
        setIsLoading(false);
      }
    }
    void loadBotsAndFlows();
  }, []);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    const socket = createAuthenticatedSocket();
    if (!socket) {
      return;
    }

    socket.on('whatsapp:qr', (event: WhatsAppQrEvent) => {
      const qrImage = event.qrDataUrl ?? event.qrCodeData ?? null;
      if (!qrImage) return;
      setBots((prev) =>
        prev.map((bot) =>
          bot.id === event.botId
            ? {
                ...bot,
                status: 'WAITING_QR',
                qrCodeData: qrImage,
                qrExpiresAt: event.qrExpiresAt ?? null
              }
            : bot
        )
      );
    });

    socket.on('whatsapp:status', (event: WhatsAppStatusEvent) => {
      setBots((prev) =>
        prev.map((bot) =>
          bot.id === event.botId
            ? {
                ...bot,
                status: event.status,
                phoneNumber:
                  event.phoneNumber !== undefined && event.phoneNumber !== null
                    ? event.phoneNumber
                    : bot.phoneNumber,
                qrCodeData:
                  event.qrDataUrl !== undefined
                    ? event.qrDataUrl
                    : event.qrCodeData !== undefined
                      ? event.qrCodeData
                      : event.status === 'CONNECTED'
                        ? null
                        : bot.qrCodeData
              }
            : bot
        )
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [accessToken]);

  async function handleCreateBot(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!newBotName.trim() || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    try {
      const { bot } = await botsApi.create({
        name: newBotName.trim(),
        phoneNumber: newBotPhone.trim(),
        description:
          newBotDescription.trim() ||
          'Bot automatizado con WhatsApp y sincronización Chatwoot.',
        driver: newBotDriver,
        activeFlowId: newBotFlowId || null,
        isActive: true,
        businessHoursEnabled: false,
        timezone: 'America/Bogota',
        outOfHoursMessage:
          'Gracias por escribirnos. En este momento estamos fuera de horario.',
        inactivityTimeoutMinutes: 15,
        typingDelayMs: 1100,
        rateLimitPerMinute: 40
      });
      setBots((prev) => [bot, ...prev]);
      setSelectedBotId(bot.id);
      setNewBotName('');
      setNewBotPhone('');
      setNewBotDescription('');
      createDialogRef.current?.close();
      setFeedbackBanner({
        type: 'ok',
        text: `Bot "${bot.name}" creado exitosamente.`
      });
    } catch (err) {
      setFeedbackBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo crear el bot.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTogglePause(botId: string): Promise<void> {
    if (busyBotId) return;
    setBusyBotId(botId);
    try {
      const { bot } = await botsApi.togglePause(botId);
      setBots((prev) => prev.map((item) => (item.id === bot.id ? bot : item)));
    } catch (err) {
      setFeedbackBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error alternando el estado del bot.'
      });
    } finally {
      setBusyBotId(null);
    }
  }

  async function handleDuplicateBot(botId: string): Promise<void> {
    if (busyBotId) return;
    setBusyBotId(botId);
    try {
      const { bot } = await botsApi.duplicate(botId);
      setBots((prev) => [bot, ...prev]);
      setSelectedBotId(bot.id);
      setFeedbackBanner({
        type: 'ok',
        text: `Bot duplicado como "${bot.name}".`
      });
    } catch (err) {
      setFeedbackBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo duplicar el bot.'
      });
    } finally {
      setBusyBotId(null);
    }
  }

  function requestDeleteBot(bot: BotDto): void {
    setDeleteTargetBot(bot);
    deleteDialogRef.current?.showModal();
  }

  async function handleConfirmDeleteBot(): Promise<void> {
    if (!deleteTargetBot || isSubmitting) return;
    const targetId = deleteTargetBot.id;
    setIsSubmitting(true);
    try {
      await botsApi.remove(targetId);
      const remaining = bots.filter((item) => item.id !== targetId);
      setBots(remaining);
      if (selectedBotId === targetId) {
        setSelectedBotId(remaining[0]?.id ?? null);
      }
      deleteDialogRef.current?.close();
      setDeleteTargetBot(null);
      setFeedbackBanner({
        type: 'ok',
        text: 'Bot eliminado correctamente.'
      });
    } catch (err) {
      setFeedbackBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo eliminar el bot.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="soft-card flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-soft-blue/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
            <Bot className="h-3.5 w-3.5" />
            <span>Gestión Multi-Sesión WhatsApp & Chatwoot</span>
          </span>
          <h1 className="mt-2 text-xl font-extrabold text-soft-ink">
            Bots de WhatsApp ({bots.length})
          </h1>
          <p className="mt-1 text-xs text-soft-muted">
            Crea bots, vincula sesiones simultáneas por código QR (Baileys) o WhatsApp Cloud API y sincronízalos con Chatwoot.
          </p>
        </div>

        {canOperateBots ? (
          <button
            type="button"
            onClick={() => createDialogRef.current?.showModal()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-gradient px-4 py-2.5 text-xs font-extrabold text-white shadow-brand-icon transition-transform hover:-translate-y-0.5"
          >
            <Plus className="h-4 w-4" />
            <span>Crear Nuevo Bot</span>
          </button>
        ) : null}
      </section>

      {feedbackBanner ? (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          role="status"
          className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs font-bold ${
            feedbackBanner.type === 'ok'
              ? 'border-[#82d616]/40 bg-[#82d616]/15 text-soft-ink'
              : 'border-soft-danger/40 bg-soft-danger/15 text-soft-danger'
          }`}
        >
          <span>{feedbackBanner.text}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="min-h-[32px] text-xs underline"
          >
            Cerrar
          </button>
        </motion.div>
      ) : null}

      {!isLoading && filteredBots.length === 0 ? (
        <div className="soft-card flex flex-wrap items-center justify-between gap-4 p-8">
          <div>
            <h2 className="text-base font-extrabold text-soft-ink">
              {bots.length === 0
                ? 'Aún no hay bots configurados'
                : 'Sin resultados para tu búsqueda'}
            </h2>
            <p className="mt-1 text-xs text-soft-muted">
              {bots.length === 0
                ? 'Crea un bot para conectar WhatsApp Cloud API, Baileys QR o Chatwoot Agent Bot.'
                : `Ningún bot coincide con "${searchQuery}".`}
            </p>
          </div>
          {canOperateBots && bots.length === 0 ? (
            <button
              type="button"
              onClick={() => createDialogRef.current?.showModal()}
              className="min-h-[44px] rounded-xl bg-brand-gradient px-4 py-2 text-xs font-extrabold text-white shadow-brand-icon"
            >
              + Crear Nuevo Bot
            </button>
          ) : null}
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredBots.map((bot) => {
            const isSelected = selectedBot?.id === bot.id;
            const isOnline = bot.status === 'CONNECTED';
            const isWaitingQr = bot.status === 'WAITING_QR';
            const isError = bot.status === 'ERROR';
            const isCardBusy = busyBotId === bot.id;

            return (
              <motion.article
                key={bot.id}
                whileHover={{ y: -2 }}
                className={`soft-card min-w-0 border-2 p-5 transition-all ${
                  isSelected ? 'border-soft-blue' : 'border-transparent'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedBotId(bot.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none focus-visible:underline"
                  >
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-gradient text-lg text-white shadow-brand-icon">
                      🤖
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-extrabold text-soft-ink">
                        {bot.name}
                      </h2>
                      <p className="truncate text-xs font-semibold text-soft-muted">
                        {bot.phoneNumber || 'Sin número asignado'}
                      </p>
                    </div>
                  </button>

                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase ${
                      isOnline
                        ? 'bg-[#82d616]/15 text-[#4b830d] dark:text-[#82d616]'
                        : isWaitingQr
                          ? 'bg-soft-warning/15 text-soft-warning'
                          : isError
                            ? 'bg-soft-danger/15 text-soft-danger'
                            : 'bg-soft-line text-soft-muted'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        isOnline
                          ? 'dot-online bg-[#82d616]'
                          : isWaitingQr
                            ? 'bg-soft-warning'
                            : isError
                              ? 'bg-soft-danger'
                              : 'bg-soft-muted'
                      }`}
                    />
                    {bot.status}
                  </span>
                </div>

                <p className="mt-3 line-clamp-2 text-xs text-soft-muted">
                  {bot.description}
                </p>

                <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-soft-bg p-2.5 text-center">
                  <div>
                    <div className="text-[10px] font-bold uppercase text-soft-muted">
                      Conexión
                    </div>
                    <div className="mt-0.5 text-xs font-extrabold text-soft-ink">
                      {bot.driver === 'CHATWOOT'
                        ? 'Chatwoot'
                        : bot.driver === 'BAILEYS'
                          ? 'Baileys QR'
                          : 'Cloud API'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase text-soft-muted">
                      Msjs Hoy
                    </div>
                    <div className="mt-0.5 text-xs font-extrabold text-soft-ink">
                      {bot.messagesToday.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase text-soft-muted">
                      Handoff
                    </div>
                    <div className="mt-0.5 text-xs font-extrabold text-soft-blue">
                      {bot.handoffRate}%
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-soft-line pt-3">
                  <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-soft-muted">
                    ⚡ Flujo: {bot.activeFlowName ?? 'Sin asignar'}
                  </span>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {canOperateBots ? (
                      <>
                        <button
                          type="button"
                          disabled={isCardBusy}
                          onClick={() => void handleTogglePause(bot.id)}
                          aria-label={
                            bot.status === 'PAUSED'
                              ? `Reanudar Bot ${bot.name}`
                              : `Pausar Bot ${bot.name}`
                          }
                          title={bot.status === 'PAUSED' ? 'Reanudar Bot' : 'Pausar Bot'}
                          className="grid min-h-[36px] min-w-[36px] place-items-center rounded-lg border border-soft-line bg-soft-bg p-1.5 text-soft-ink hover:border-soft-blue disabled:opacity-50"
                        >
                          {bot.status === 'PAUSED' ? (
                            <Play className="h-3.5 w-3.5 text-[#4b830d] dark:text-[#82d616]" />
                          ) : (
                            <Pause className="h-3.5 w-3.5 text-soft-warning" />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isCardBusy}
                          onClick={() => void handleDuplicateBot(bot.id)}
                          aria-label={`Duplicar Bot ${bot.name}`}
                          title="Duplicar Bot"
                          className="grid min-h-[36px] min-w-[36px] place-items-center rounded-lg border border-soft-line bg-soft-bg p-1.5 text-soft-ink hover:border-soft-blue disabled:opacity-50"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : null}
                    {isAdmin ? (
                      <button
                        type="button"
                        disabled={isCardBusy}
                        onClick={() => requestDeleteBot(bot)}
                        aria-label={`Eliminar Bot ${bot.name}`}
                        title="Eliminar Bot"
                        className="grid min-h-[36px] min-w-[36px] place-items-center rounded-lg border border-soft-line bg-soft-bg p-1.5 text-soft-danger hover:border-soft-danger disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </motion.article>
            );
          })}
        </section>
      )}

      {selectedBot ? (
        <BotConfigTabs
          selectedBot={selectedBot}
          flows={flows}
          onBotUpdated={(updated) =>
            setBots((prev) =>
              prev.map((item) => (item.id === updated.id ? updated : item))
            )
          }
          onFeedback={(type, text) => setFeedbackBanner({ type, text })}
        />
      ) : null}

      <dialog
        ref={createDialogRef}
        aria-labelledby={createDialogTitleId}
        className="w-full max-w-lg rounded-2xl border border-soft-line bg-soft-card p-6 text-soft-ink shadow-soft"
      >
        <h2 id={createDialogTitleId} className="text-lg font-extrabold text-soft-ink">
          Crear Nuevo Bot de WhatsApp
        </h2>
        <form onSubmit={handleCreateBot} className="mt-4 flex flex-col gap-3.5">
          <div>
            <label
              htmlFor="new-bot-name"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Nombre del Bot *
            </label>
            <input
              id="new-bot-name"
              name="name"
              type="text"
              required
              autoFocus
              placeholder="Ej: Bot Atención Comercial"
              value={newBotName}
              onChange={(e) => setNewBotName(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
            />
          </div>

          <fieldset className="rounded-xl border border-soft-line bg-soft-bg p-3">
            <legend className="px-1 text-xs font-bold text-soft-ink">
              Modo de Conexión del Bot
            </legend>
            <div className="mt-1.5 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  id="driver-chatwoot"
                  type="radio"
                  name="driver"
                  value="CHATWOOT"
                  checked={newBotDriver === 'CHATWOOT'}
                  onChange={() => setNewBotDriver('CHATWOOT')}
                />
                <label htmlFor="driver-chatwoot" className="text-xs font-bold text-soft-ink">
                  Solo Chatwoot (Agent Bot)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="driver-baileys"
                  type="radio"
                  name="driver"
                  value="BAILEYS"
                  checked={newBotDriver === 'BAILEYS'}
                  onChange={() => setNewBotDriver('BAILEYS')}
                />
                <label htmlFor="driver-baileys" className="text-xs font-bold text-soft-ink">
                  Baileys Multi-Device (QR)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="driver-cloud"
                  type="radio"
                  name="driver"
                  value="CLOUD_API"
                  checked={newBotDriver === 'CLOUD_API'}
                  onChange={() => setNewBotDriver('CLOUD_API')}
                />
                <label htmlFor="driver-cloud" className="text-xs font-bold text-soft-ink">
                  WhatsApp Cloud API Oficial
                </label>
              </div>
            </div>
          </fieldset>

          {newBotDriver !== 'CHATWOOT' ? (
            <div>
              <label
                htmlFor="new-bot-phone"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Número de WhatsApp
              </label>
              <input
                id="new-bot-phone"
                name="phoneNumber"
                type="tel"
                autoComplete="tel"
                placeholder="Ej: +18097504293"
                value={newBotPhone}
                onChange={(e) => setNewBotPhone(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
              />
            </div>
          ) : null}

          <div>
            <label
              htmlFor="new-bot-flow"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Flujo Conversacional Inicial
            </label>
            <select
              id="new-bot-flow"
              name="activeFlowId"
              value={newBotFlowId}
              onChange={(e) => setNewBotFlowId(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs font-bold text-soft-ink"
            >
              <option value="">Sin flujo asignado</option>
              {flows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="new-bot-desc"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Descripción
            </label>
            <textarea
              id="new-bot-desc"
              name="description"
              rows={2}
              value={newBotDescription}
              onChange={(e) => setNewBotDescription(e.target.value)}
              placeholder="Objetivo del bot y equipo asignado en Chatwoot..."
              className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
            />
          </div>

          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => createDialogRef.current?.close()}
              className="min-h-[40px] rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-bold text-soft-ink"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-[40px] rounded-xl bg-brand-gradient px-5 py-2 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
            >
              {isSubmitting ? 'Creando...' : 'Crear Bot'}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={deleteDialogRef}
        aria-labelledby={deleteDialogTitleId}
        className="w-full max-w-md rounded-2xl border border-soft-line bg-soft-card p-6 text-soft-ink shadow-soft"
      >
        <h2 id={deleteDialogTitleId} className="text-base font-extrabold text-soft-ink">
          Eliminar Bot Permanentemente
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-soft-muted">
          ¿Seguro que deseas eliminar el bot{' '}
          <strong className="text-soft-ink">{deleteTargetBot?.name}</strong>? Se desconectará la sesión activa y se desvinculará de sus flujos asociados.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              deleteDialogRef.current?.close();
              setDeleteTargetBot(null);
            }}
            className="min-h-[40px] rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-bold text-soft-ink"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleConfirmDeleteBot()}
            className="min-h-[40px] rounded-xl bg-soft-danger px-4 py-2 text-xs font-extrabold text-white disabled:opacity-60"
          >
            {isSubmitting ? 'Eliminando...' : 'Eliminar Bot'}
          </button>
        </div>
      </dialog>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-soft-muted">
          <WifiOff className="h-4 w-4 animate-pulse" />
          <span>Sincronizando estado de bots...</span>
        </div>
      ) : null}
    </div>
  );
}
