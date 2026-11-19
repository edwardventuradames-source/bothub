import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { BotConnectionStatus, DashboardMetricsDto } from '@bothub/shared';
import { AnimatedCounter } from '../components/ui/AnimatedCounter.js';
import { botsApi, platformApi } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import { useAuthStore } from '../store/auth.store.js';

interface KpiItem {
  id: string;
  label: string;
  value: number;
  variation: string;
  isPositive: boolean;
  emoji: string;
}

interface DashboardBotCard {
  id: string;
  name: string;
  subtitle: string;
  statusLabel: string;
  statusType: 'online' | 'qr' | 'err' | 'off';
  metaText: string;
  isEnabled: boolean;
}

const EMPTY_KPI_ITEMS: KpiItem[] = [
  {
    id: 'messages-today',
    label: 'Mensajes hoy',
    value: 0,
    variation: 'En vivo',
    isPositive: true,
    emoji: '💬'
  },
  {
    id: 'bots-online',
    label: 'Bots en línea',
    value: 0,
    variation: 'de 0',
    isPositive: true,
    emoji: '🤖'
  },
  {
    id: 'active-conversations',
    label: 'Conversaciones activas',
    value: 0,
    variation: 'En vivo',
    isPositive: true,
    emoji: '👥'
  },
  {
    id: 'handoff-transfers',
    label: 'Transferidas a agente',
    value: 0,
    variation: 'Chatwoot',
    isPositive: true,
    emoji: '🎧'
  }
];

const FLOW_PREVIEW_NODES = [
  { id: 'start', label: '▶ Inicio', isPrimary: true },
  { id: 'welcome', label: '💬 Bienvenida', isPrimary: false },
  { id: 'menu', label: '🔘 Menú', isPrimary: false },
  { id: 'cedula', label: '❓ Captura cédula', isPrimary: false },
  { id: 'schedule', label: '🔀 Horario', isPrimary: false },
  { id: 'handoff', label: '🎧 Transferir a agente', isPrimary: false }
];

function getDriverLabel(driver: 'CHATWOOT' | 'BAILEYS' | 'CLOUD_API'): string {
  if (driver === 'CHATWOOT') return 'Chatwoot';
  if (driver === 'BAILEYS') return 'Baileys QR';
  return 'Cloud API';
}

function getStatusMeta(status: BotConnectionStatus): {
  label: string;
  type: 'online' | 'qr' | 'err' | 'off';
  isEnabled: boolean;
} {
  if (status === 'CONNECTED') {
    return { label: 'En línea', type: 'online', isEnabled: true };
  }
  if (status === 'WAITING_QR') {
    return { label: 'Esperando QR', type: 'qr', isEnabled: true };
  }
  if (status === 'RECONNECTING') {
    return { label: 'Reconectando', type: 'qr', isEnabled: true };
  }
  if (status === 'ERROR') {
    return { label: 'Error', type: 'err', isEnabled: false };
  }
  if (status === 'PAUSED') {
    return { label: 'Pausado', type: 'off', isEnabled: false };
  }
  return { label: 'Desconectado', type: 'off', isEnabled: false };
}

export function DashboardPreviewPage() {
  const user = useAuthStore((s) => s.user);
  const canOperateBots = user?.role === 'ADMIN' || user?.role === 'OPERATOR';

  const [kpis, setKpis] = useState<KpiItem[]>(EMPTY_KPI_ITEMS);
  const [bots, setBots] = useState<DashboardBotCard[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetricsDto | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [togglingBotId, setTogglingBotId] = useState<string | null>(null);

  useEffect(() => {
    async function syncLiveMetrics(): Promise<void> {
      try {
        const data = await platformApi.getDashboard();
        setMetrics(data.metrics);
        setErrorBanner(null);
        setBots(
          data.bots.map((b) => {
            const statusMeta = getStatusMeta(b.status);
            return {
              id: b.id,
              name: b.name,
              subtitle: `${getDriverLabel(b.driver)} · ${
                b.chatwootConfig
                  ? `Chatwoot inbox #${b.chatwootConfig.inboxId}`
                  : b.phoneNumber || 'Sin número'
              }`,
              statusLabel: statusMeta.label,
              statusType: statusMeta.type,
              metaText: `${b.messagesToday.toLocaleString()} msgs hoy`,
              isEnabled: statusMeta.isEnabled
            };
          })
        );

        setKpis([
          {
            id: 'messages-today',
            label: 'Mensajes hoy',
            value: data.metrics.messagesToday,
            variation: 'En vivo',
            isPositive: true,
            emoji: '💬'
          },
          {
            id: 'bots-online',
            label: 'Bots en línea',
            value: data.metrics.activeBots,
            variation: `de ${data.metrics.totalBots}`,
            isPositive: true,
            emoji: '🤖'
          },
          {
            id: 'active-conversations',
            label: 'Conversaciones activas',
            value: data.metrics.activeConversations,
            variation: `${data.metrics.automationRatePercent}% auto`,
            isPositive: true,
            emoji: '👥'
          },
          {
            id: 'handoff-transfers',
            label: 'Transferidas a agente',
            value: data.metrics.handoffCountToday,
            variation: 'Chatwoot',
            isPositive: true,
            emoji: '🎧'
          }
        ]);
      } catch (err) {
        setErrorBanner(
          err instanceof Error
            ? err.message
            : 'No se pudieron sincronizar las métricas en vivo.'
        );
      }
    }
    void syncLiveMetrics();
  }, []);

  async function handleToggleBot(botId: string): Promise<void> {
    if (!canOperateBots || togglingBotId) return;
    setTogglingBotId(botId);
    setErrorBanner(null);
    try {
      const { bot } = await botsApi.togglePause(botId);
      const statusMeta = getStatusMeta(bot.status);
      setBots((current) =>
        current.map((item) =>
          item.id === botId
            ? {
                ...item,
                statusLabel: statusMeta.label,
                statusType: statusMeta.type,
                isEnabled: statusMeta.isEnabled
              }
            : item
        )
      );
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : 'No se pudo cambiar el estado del bot.'
      );
    } finally {
      setTogglingBotId(null);
    }
  }

  const hourlyData = metrics?.hourlyMessages ?? [];
  const weeklyData = metrics?.weeklyFlowPerformance ?? [];
  const hasWeeklyTraffic = weeklyData.some(
    (item) => item.resolvedByBot > 0 || item.transferredToAgent > 0
  );
  const hasHourlyTraffic = hourlyData.some(
    (item) => item.inbound > 0 || item.outbound > 0
  );

  return (
    <div className="flex flex-col gap-6">
      {errorBanner ? (
        <div
          role="alert"
          className="rounded-2xl border border-soft-danger/30 bg-soft-danger/10 px-4 py-3 text-xs font-bold text-soft-danger"
        >
          {errorBanner}
        </div>
      ) : null}

      <section
        aria-label="Indicadores clave de rendimiento"
        className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4"
      >
        {kpis.map((kpi, index) => (
          <motion.div
            key={kpi.id}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.06 }}
            whileHover={{ y: -4 }}
            className="soft-card flex items-center justify-between p-4"
          >
            <div className="min-w-0">
              <span className="text-[13px] font-semibold text-soft-muted">
                {kpi.label}
              </span>
              <strong className="mt-1 block text-xl font-bold text-soft-ink">
                <AnimatedCounter value={kpi.value} />
                <span
                  className={cn(
                    'ml-1.5 text-xs font-bold',
                    kpi.isPositive ? 'text-[#4b830d] dark:text-[#82d616]' : 'text-[#ea0606]'
                  )}
                >
                  {kpi.variation}
                </span>
              </strong>
            </div>
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-gradient text-xl text-white shadow-brand-icon">
              {kpi.emoji}
            </div>
          </motion.div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2 }}
          className="soft-card grid grid-cols-1 gap-4 p-4 sm:grid-cols-2"
        >
          <div className="flex flex-col">
            <small className="text-xs font-semibold text-soft-muted">
              Construido para Chatwoot
            </small>
            <h2 className="mt-1 mb-2 text-xl font-bold text-soft-ink">
              Crea tu bot de WhatsApp
            </h2>
            <p className="m-0 text-sm leading-relaxed text-soft-muted">
              Diseña flujos visuales, conecta tu número por QR o Cloud API y transfiere a tus agentes cuando haga falta.
            </p>
            <Link
              to="/bots"
              className="mt-auto inline-flex min-h-[44px] items-center pt-4 text-sm font-bold text-soft-blue transition-colors hover:underline"
            >
              Crear bot →
            </Link>
          </div>
          <div className="relative grid min-h-[200px] place-items-center overflow-hidden rounded-[14px] bg-brand-gradient">
            <div className="float-bot-3d text-[84px]">🤖</div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.26 }}
          className="soft-card p-4"
        >
          <div className="flex min-h-[200px] flex-col justify-between rounded-[14px] bg-dark-gradient p-5 text-white">
            <div>
              <h3 className="m-0 mb-2.5 text-lg font-bold">
                Handoff inteligente
              </h3>
              <p className="m-0 text-sm leading-relaxed opacity-85">
                El bot atiende primero y pasa la conversación al equipo correcto con un resumen en nota privada.
              </p>
            </div>
            <Link
              to="/flows"
              className="inline-flex min-h-[44px] items-center text-sm font-bold text-white transition-transform hover:translate-x-1"
            >
              Ver flujos →
            </Link>
          </div>
        </motion.div>
      </section>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.3fr]">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.32 }}
          className="soft-card flex flex-col p-4"
        >
          <div className="h-[190px] w-full rounded-[14px] bg-dark-gradient p-3">
            {hasWeeklyTraffic ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyData}>
                  <XAxis
                    dataKey="day"
                    stroke="#cbd5e1"
                    tick={{ fill: '#cbd5e1', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    stroke="#cbd5e1"
                    tick={{ fill: '#cbd5e1', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1a2035',
                      border: '1px solid #2a3350',
                      borderRadius: '10px',
                      color: '#f1f5f9',
                      fontSize: '12px'
                    }}
                  />
                  <Bar
                    dataKey="resolvedByBot"
                    name="Bot"
                    fill="#21d4fd"
                    radius={[6, 6, 0, 0]}
                  />
                  <Bar
                    dataKey="transferredToAgent"
                    name="Handoff"
                    fill="#82d616"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-center text-xs font-semibold text-white/80">
                Sin conversaciones registradas esta semana todavía.
              </div>
            )}
          </div>
          <h4 className="mt-4 mb-0.5 text-[15px] font-bold text-soft-ink">
            Rendimiento semanal de conversaciones
          </h4>
          <small className="text-xs text-soft-muted">
            Resueltas por bot vs. transferidas a agente humano
          </small>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.38 }}
          className="soft-card flex flex-col p-4"
        >
          <h4 className="m-0 text-[15px] font-bold text-soft-ink">
            Tráfico de mensajes (últimas 24h)
          </h4>
          <small className="text-xs font-semibold text-soft-muted">
            Entrantes (WhatsApp / Chatwoot) vs. salientes del bot
          </small>
          <div className="mt-3 h-[200px] w-full">
            {hasHourlyTraffic ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hourlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'var(--mut)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: 'var(--mut)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--card)',
                      border: '1px solid var(--line)',
                      borderRadius: '10px',
                      color: 'var(--ink)',
                      fontSize: '12px'
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="inbound"
                    name="Entrantes"
                    stroke="#2152ff"
                    fill="#2152ff"
                    fillOpacity={0.18}
                    strokeWidth={2.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="outbound"
                    name="Salientes"
                    stroke="#17c1e8"
                    fill="#17c1e8"
                    fillOpacity={0.14}
                    strokeWidth={2.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center rounded-xl border border-dashed border-soft-line bg-soft-bg px-4 text-center text-xs text-soft-muted">
                Aún no hay tráfico de mensajes en las últimas 24 horas. Envía un mensaje de prueba desde el simulador o webhook para ver la serie en vivo.
              </div>
            )}
          </div>
        </motion.div>
      </section>

      <section aria-label="Estado de sesiones de bots">
        {bots.length === 0 ? (
          <div className="soft-card flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <h4 className="text-base font-extrabold text-soft-ink">
                Aún no tienes bots creados
              </h4>
              <p className="mt-1 text-xs text-soft-muted">
                Tu entorno está completamente limpio y sin datos de prueba. Crea tu primer bot para conectarlo por código QR o WhatsApp Cloud API.
              </p>
            </div>
            <Link
              to="/bots"
              className="inline-flex min-h-[44px] items-center rounded-xl bg-brand-gradient px-4 py-2.5 text-xs font-extrabold text-white shadow-brand-icon"
            >
              + Crear mi primer Bot
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {bots.map((bot, idx) => (
              <motion.div
                key={bot.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.42 + idx * 0.06 }}
                whileHover={{ y: -4 }}
                className="soft-card min-w-0 p-4"
              >
                <h4 className="m-0 mb-0.5 truncate text-[15px] font-bold text-soft-ink">
                  {bot.name}
                </h4>
                <small className="block truncate text-xs text-soft-muted">
                  {bot.subtitle}
                </small>

                <div className="my-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-soft-ink">
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      bot.statusType === 'online' && 'dot-online bg-[#82d616]',
                      bot.statusType === 'qr' && 'bg-[#fb8c00]',
                      bot.statusType === 'err' && 'bg-[#ea0606]',
                      bot.statusType === 'off' && 'bg-[#adb5bd]'
                    )}
                  />
                  <span>{bot.statusLabel}</span>
                </div>

                <div className="flex items-center justify-between border-t border-soft-line pt-2.5 text-xs text-soft-muted">
                  <span>{bot.metaText}</span>
                  <button
                    type="button"
                    role="switch"
                    disabled={!canOperateBots || togglingBotId === bot.id}
                    aria-checked={bot.isEnabled}
                    aria-label={`Alternar estado de ${bot.name}`}
                    onClick={() => void handleToggleBot(bot.id)}
                    className={cn(
                      'relative h-6 w-10 cursor-pointer rounded-full border-0 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
                      bot.isEnabled ? 'bg-brand-gradient' : 'bg-[#ced4da]'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-1 h-4 w-4 rounded-full bg-white transition-all duration-200',
                        bot.isEnabled ? 'right-1' : 'right-[20px]'
                      )}
                    />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.56 }}
        className="soft-card p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="m-0 text-[15px] font-bold text-soft-ink">
            Constructor de Flujos Conversacionales
          </h4>
          <Link
            to="/flows"
            className="inline-flex min-h-[40px] items-center text-xs font-extrabold text-soft-blue hover:underline"
          >
            Abrir Constructor Visual →
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {FLOW_PREVIEW_NODES.map((node, index) => (
            <div key={node.id} className="flex items-center gap-2.5">
              <Link
                to="/flows"
                className={cn(
                  'rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-transform hover:-translate-y-0.5',
                  node.isPrimary
                    ? 'bg-brand-gradient text-white shadow-brand-icon'
                    : 'border border-soft-line bg-soft-bg text-soft-ink hover:border-soft-blue'
                )}
              >
                {node.label}
              </Link>
              {index < FLOW_PREVIEW_NODES.length - 1 ? (
                <span className="text-soft-muted">→</span>
              ) : null}
            </div>
          ))}
        </div>
      </motion.section>
    </div>
  );
}
