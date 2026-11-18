import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimatedCounter } from '../components/ui/AnimatedCounter.js';
import { cn } from '../lib/utils.js';

interface KpiItem {
  id: string;
  label: string;
  value: number;
  variation: string;
  isPositive: boolean;
  emoji: string;
}

interface PreviewBotCard {
  id: string;
  name: string;
  subtitle: string;
  statusLabel: string;
  statusType: 'online' | 'qr' | 'off';
  metaText: string;
  isEnabled: boolean;
}

const KPI_ITEMS: KpiItem[] = [
  {
    id: 'messages-today',
    label: 'Mensajes hoy',
    value: 12480,
    variation: '+18%',
    isPositive: true,
    emoji: '💬'
  },
  {
    id: 'bots-online',
    label: 'Bots en línea',
    value: 7,
    variation: '+2',
    isPositive: true,
    emoji: '🤖'
  },
  {
    id: 'active-conversations',
    label: 'Conversaciones activas',
    value: 342,
    variation: '-2%',
    isPositive: false,
    emoji: '👥'
  },
  {
    id: 'handoff-transfers',
    label: 'Transferidas a agente',
    value: 96,
    variation: '+5%',
    isPositive: true,
    emoji: '🎧'
  }
];

const BAR_HEIGHT_PERCENTAGES = [60, 35, 20, 45, 100, 20, 70, 40, 100];

const INITIAL_BOT_CARDS: PreviewBotCard[] = [
  {
    id: 'bot-gruas',
    name: 'Soporte Grúas',
    subtitle: 'Cloud API · Chatwoot inbox #3',
    statusLabel: 'En línea',
    statusType: 'online',
    metaText: '1.2k msgs hoy',
    isEnabled: true
  },
  {
    id: 'bot-ventas',
    name: 'Ventas',
    subtitle: 'Baileys · Chatwoot inbox #5',
    statusLabel: 'Esperando QR',
    statusType: 'qr',
    metaText: 'Escanear para conectar',
    isEnabled: true
  },
  {
    id: 'bot-cobranza',
    name: 'Cobranza',
    subtitle: 'Baileys · Chatwoot inbox #6',
    statusLabel: 'Pausado',
    statusType: 'off',
    metaText: 'Último mensaje: ayer',
    isEnabled: false
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

export function DashboardPreviewPage() {
  const [bots, setBots] = useState<PreviewBotCard[]>(INITIAL_BOT_CARDS);

  function handleToggleBot(botId: string): void {
    setBots((current) =>
      current.map((bot) => {
        if (bot.id !== botId) {
          return bot;
        }
        const nextEnabled = !bot.isEnabled;
        return {
          ...bot,
          isEnabled: nextEnabled,
          statusType: nextEnabled
            ? bot.id === 'bot-ventas'
              ? 'qr'
              : 'online'
            : 'off',
          statusLabel: nextEnabled
            ? bot.id === 'bot-ventas'
              ? 'Esperando QR'
              : 'En línea'
            : 'Pausado'
        };
      })
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label="Indicadores clave de rendimiento"
        className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4"
      >
        {KPI_ITEMS.map((kpi, index) => (
          <motion.div
            key={kpi.id}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.06 }}
            whileHover={{ y: -4 }}
            className="soft-card flex items-center justify-between p-4"
          >
            <div>
              <span className="text-[13px] font-semibold text-soft-muted">
                {kpi.label}
              </span>
              <strong className="mt-1 block text-xl font-bold text-soft-ink">
                <AnimatedCounter value={kpi.value} />
                <span
                  className={cn(
                    'ml-1.5 text-xs font-bold',
                    kpi.isPositive ? 'text-[#82d616]' : 'text-[#ea0606]'
                  )}
                >
                  {kpi.variation}
                </span>
              </strong>
            </div>
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand-gradient text-xl text-white shadow-brand-icon">
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
              className="mt-auto pt-4 text-sm font-bold text-soft-muted transition-colors hover:text-soft-ink"
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
              className="text-sm font-bold text-white transition-transform hover:translate-x-1"
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
          className="soft-card p-4"
        >
          <div className="flex h-[170px] items-end justify-around rounded-[14px] bg-dark-gradient p-4">
            {BAR_HEIGHT_PERCENTAGES.map((heightPct, idx) => (
              <motion.i
                key={idx}
                initial={{ height: 0 }}
                animate={{ height: `${heightPct}%` }}
                transition={{
                  duration: 0.85,
                  delay: 0.3 + idx * 0.07,
                  ease: 'easeOut'
                }}
                className="w-1.5 rounded-md bg-white"
              />
            ))}
          </div>
          <h4 className="mt-4 mb-0.5 text-[15px] font-bold text-soft-ink">
            Usuarios activos
          </h4>
          <small className="text-xs text-soft-muted">
            <strong className="text-soft-ink">(+23%)</strong> que la semana pasada
          </small>
          <div className="mt-3 flex flex-wrap gap-5 text-xs text-soft-muted">
            <span className="inline-flex items-center">
              <i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] bg-[#cb0c9f]" />
              Usuarios
            </span>
            <span className="inline-flex items-center">
              <i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] bg-[#17c1e8]" />
              Clics
            </span>
            <span className="inline-flex items-center">
              <i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] bg-[#fb8c00]" />
              Ventas
            </span>
            <span className="inline-flex items-center">
              <i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] bg-[#ea0606]" />
              Items
            </span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.38 }}
          className="soft-card p-4"
        >
          <h4 className="m-0 text-[15px] font-bold text-soft-ink">
            Resumen de mensajes
          </h4>
          <small className="text-xs font-semibold text-[#82d616]">
            ↑ 4% más en 2026
          </small>
          <svg
            viewBox="0 0 600 260"
            width="100%"
            className="mt-2 overflow-visible"
            role="img"
            aria-label="Gráfica de líneas de resumen de mensajes"
          >
            <defs>
              <linearGradient id="cyanAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#17c1e8" stopOpacity="0.35" />
                <stop offset="1" stopColor="#17c1e8" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g stroke="var(--line)" strokeDasharray="4">
              <path d="M30 20H590M30 70H590M30 120H590M30 170H590M30 220H590" />
            </g>
            <path
              d="M30 220C90 150 120 140 160 190S230 40 280 30 340 170 380 150 450 110 490 150 560 140 590 30V220H30Z"
              fill="url(#cyanAreaGrad)"
            />
            <path
              className="svg-line-animated"
              d="M30 220C90 150 120 140 160 190S230 40 280 30 340 170 380 150 450 110 490 150 560 140 590 30"
              fill="none"
              stroke="#17c1e8"
              strokeWidth="3"
            />
            <path
              className="svg-line-animated"
              d="M30 230C100 200 160 120 220 130S320 150 360 120 450 160 490 190 560 130 590 110"
              fill="none"
              stroke="var(--ink)"
              strokeWidth="3"
            />
          </svg>
        </motion.div>
      </section>

      <section
        aria-label="Estado de sesiones de bots"
        className="grid grid-cols-1 gap-5 md:grid-cols-3"
      >
        {bots.map((bot, idx) => (
          <motion.div
            key={bot.id}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.42 + idx * 0.06 }}
            whileHover={{ y: -4 }}
            className="soft-card p-4"
          >
            <h4 className="m-0 mb-0.5 text-[15px] font-bold text-soft-ink">
              {bot.name}
            </h4>
            <small className="block text-xs text-soft-muted">
              {bot.subtitle}
            </small>

            <div className="my-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-soft-ink">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  bot.statusType === 'online' && 'dot-online bg-[#82d616]',
                  bot.statusType === 'qr' && 'bg-[#fb8c00]',
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
                aria-checked={bot.isEnabled}
                aria-label={`Alternar estado de ${bot.name}`}
                onClick={() => handleToggleBot(bot.id)}
                className={cn(
                  'relative h-5 w-9 cursor-pointer rounded-full border-0 transition-colors duration-200',
                  bot.isEnabled ? 'bg-brand-gradient' : 'bg-[#ced4da]'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all duration-200',
                    bot.isEnabled ? 'right-0.5' : 'right-[18px]'
                  )}
                />
              </button>
            </div>
          </motion.div>
        ))}
      </section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.56 }}
        className="soft-card p-4"
      >
        <h4 className="m-0 text-[15px] font-bold text-soft-ink">
          Editor de flujos · Menú principal
        </h4>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {FLOW_PREVIEW_NODES.map((node, index) => (
            <div key={node.id} className="flex items-center gap-2.5">
              <div
                className={cn(
                  'rounded-xl px-3.5 py-2.5 text-xs font-semibold',
                  node.isPrimary
                    ? 'bg-brand-gradient text-white shadow-brand-icon'
                    : 'border border-soft-line bg-soft-bg text-soft-ink'
                )}
              >
                {node.label}
              </div>
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
