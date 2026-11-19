import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { io } from 'socket.io-client';
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
import { BotConfigTabs } from '../components/bots/BotConfigTabs.js';
import { useAuthStore } from '../store/auth.store.js';

export function BotsPage() {
  const createDialogTitleId = useId();
  const createDialogRef = useRef<HTMLDialogElement | null>(null);

  const [bots, setBots] = useState<BotDto[]>([]);
  const [flows, setFlows] = useState<FlowDto[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const [newBotName, setNewBotName] = useState('');
  const [newBotPhone, setNewBotPhone] = useState('');
  const [newBotDescription, setNewBotDescription] = useState('');
  const [newBotDriver, setNewBotDriver] = useState<WhatsAppDriverType>('CHATWOOT');
  const [newBotFlowId, setNewBotFlowId] = useState<string>('');

  const user = useAuthStore((s) => s.user);
  const selectedBot = bots.find((b) => b.id === selectedBotId) ?? bots[0] ?? null;

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
      } finally {
        setIsLoading(false);
      }
    }
    void loadBotsAndFlows();
  }, []);

  useEffect(() => {
    const wsUrl = import.meta.env.VITE_WS_URL || undefined;
    const socket = io(wsUrl, {
      auth: {
        organizationId: user?.organizationId
      },
      transports: ['websocket', 'polling']
    });

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
  }, [user?.organizationId]);

  async function handleCreateBot(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!newBotName.trim()) {
      return;
    }
    const { bot } = await botsApi.create({
      name: newBotName.trim(),
      phoneNumber: newBotPhone.trim(),
      description:
        newBotDescription.trim() ||
        'Bot automatizado con WhatsApp y sincronización Chatwoot.',
      driver: newBotDriver,
      activeFlowId: newBotFlowId || null,
      isActive: true,
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
    setNewBotDescription('');
    createDialogRef.current?.close();
    setFeedbackBanner({
      type: 'ok',
      text: `Bot "${bot.name}" creado exitosamente.`
    });
  }

  async function handleTogglePause(botId: string): Promise<void> {
    const { bot } = await botsApi.togglePause(botId);
    setBots((prev) => prev.map((item) => (item.id === bot.id ? bot : item)));
  }

  async function handleDuplicateBot(botId: string): Promise<void> {
    const { bot } = await botsApi.duplicate(botId);
    setBots((prev) => [bot, ...prev]);
    setSelectedBotId(bot.id);
    setFeedbackBanner({
      type: 'ok',
      text: `Bot duplicado como "${bot.name}".`
    });
  }

  async function handleDeleteBot(botId: string): Promise<void> {
    await botsApi.remove(botId);
    const remaining = bots.filter((item) => item.id !== botId);
    setBots(remaining);
    if (selectedBotId === botId) {
      setSelectedBotId(remaining[0]?.id ?? null);
    }
    setFeedbackBanner({
      type: 'ok',
      text: 'Bot eliminado correctamente.'
    });
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

        <button
          type="button"
          onClick={() => createDialogRef.current?.showModal()}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-4 py-2.5 text-xs font-extrabold text-white shadow-brand-icon transition-transform hover:-translate-y-0.5"
        >
          <Plus className="h-4 w-4" />
          <span>Crear Nuevo Bot</span>
        </button>
      </section>

      {feedbackBanner ? (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          role="status"
          className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-xs font-bold ${
            feedbackBanner.type === 'ok'
              ? 'border-[#82d616]/40 bg-[#82d616]/15 text-soft-ink'
              : 'border-soft-danger/40 bg-soft-danger/15 text-soft-danger'
          }`}
        >
          <span>{feedbackBanner.text}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-xs underline"
          >
            Cerrar
          </button>
        </motion.div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {bots.map((bot) => {
          const isSelected = selectedBot?.id === bot.id;
          const isOnline = bot.status === 'CONNECTED';
          const isWaitingQr = bot.status === 'WAITING_QR';
          const isError = bot.status === 'ERROR';

          return (
            <motion.article
              key={bot.id}
              whileHover={{ y: -2 }}
              onClick={() => setSelectedBotId(bot.id)}
              className={`soft-card cursor-pointer border-2 p-5 transition-all ${
                isSelected ? 'border-soft-blue' : 'border-transparent'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-gradient text-lg text-white shadow-brand-icon">
                    🤖
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-soft-ink">
                      {bot.name}
                    </h2>
                    <p className="text-xs font-semibold text-soft-muted">
                      {bot.phoneNumber}
                    </p>
                  </div>
                </div>

                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase ${
                    isOnline
                      ? 'bg-[#82d616]/15 text-[#4b830d] dark:text-[#82d616]'
                      : isWaitingQr
                        ? 'bg-soft-warn/15 text-soft-warn'
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
                          ? 'bg-soft-warn'
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
                      ? 'Solo Chatwoot'
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
                <span className="truncate text-[11px] font-bold text-soft-muted">
                  ⚡ Flujo: {bot.activeFlowName ?? 'Sin asignar'}
                </span>

                <div
                  className="flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => handleTogglePause(bot.id)}
                    title={bot.status === 'PAUSED' ? 'Reanudar Bot' : 'Pausar Bot'}
                    className="rounded-lg border border-soft-line bg-soft-bg p-1.5 text-soft-ink hover:border-soft-blue"
                  >
                    {bot.status === 'PAUSED' ? (
                      <Play className="h-3.5 w-3.5 text-[#82d616]" />
                    ) : (
                      <Pause className="h-3.5 w-3.5 text-soft-warn" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicateBot(bot.id)}
                    title="Duplicar Bot"
                    className="rounded-lg border border-soft-line bg-soft-bg p-1.5 text-soft-ink hover:border-soft-blue"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteBot(bot.id)}
                    title="Eliminar Bot"
                    className="rounded-lg border border-soft-line bg-soft-bg p-1.5 text-soft-danger hover:border-soft-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </motion.article>
          );
        })}
      </section>

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
              className="rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-bold text-soft-ink"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-xl bg-brand-gradient px-5 py-2 text-xs font-extrabold text-white shadow-brand-icon"
            >
              Crear Bot
            </button>
          </div>
        </form>
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
