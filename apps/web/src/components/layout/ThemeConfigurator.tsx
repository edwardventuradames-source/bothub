import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Monitor, Moon, Sun, X } from 'lucide-react';
import {
  ColorSchemePreference,
  SidebarAccentColor,
  useThemeStore
} from '../../store/theme.store.js';
import { cn } from '../../lib/utils.js';

const ACCENT_OPTIONS: Array<{
  id: SidebarAccentColor;
  label: string;
  previewClass: string;
}> = [
  {
    id: 'blue',
    label: 'Azul Cian (Soft UI)',
    previewClass: 'bg-gradient-to-tr from-[#2152ff] to-[#21d4fd]'
  },
  {
    id: 'purple',
    label: 'Violeta Magenta',
    previewClass: 'bg-gradient-to-tr from-[#7928ca] to-[#ff0080]'
  },
  {
    id: 'emerald',
    label: 'Verde Esmeralda',
    previewClass: 'bg-gradient-to-tr from-[#17ad37] to-[#82d616]'
  },
  {
    id: 'orange',
    label: 'Naranja Solar',
    previewClass: 'bg-gradient-to-tr from-[#f53939] to-[#fbcf33]'
  },
  {
    id: 'slate',
    label: 'Noche Pizarra',
    previewClass: 'bg-gradient-to-tr from-[#141727] to-[#3a416f]'
  }
];

const SCHEME_OPTIONS: Array<{
  id: ColorSchemePreference;
  label: string;
  icon: typeof Sun;
}> = [
  { id: 'light', label: 'Claro', icon: Sun },
  { id: 'dark', label: 'Oscuro', icon: Moon },
  { id: 'system', label: 'Sistema', icon: Monitor }
];

export function ThemeConfigurator() {
  const {
    preference,
    accentColor,
    isConfiguratorOpen,
    setPreference,
    setAccentColor,
    setConfiguratorOpen
  } = useThemeStore();

  useEffect(() => {
    if (!isConfiguratorOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConfiguratorOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isConfiguratorOpen, setConfiguratorOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfiguratorOpen(!isConfiguratorOpen)}
        aria-label="Cambiar tema y configuración visual"
        className="fixed right-5 bottom-5 z-40 grid h-11 w-11 place-items-center rounded-full border border-soft-line bg-soft-card text-lg text-soft-ink shadow-soft transition-transform duration-300 hover:rotate-90"
      >
        ⚙
      </button>

      <AnimatePresence>
        {isConfiguratorOpen ? (
          <div className="fixed inset-0 z-50 flex justify-end">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfiguratorOpen(false)}
              className="fixed inset-0 bg-black/30 backdrop-blur-sm"
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Configurador Soft UI"
              initial={{ x: 340, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 340, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="relative z-10 flex h-full w-80 max-w-full flex-col justify-between bg-soft-card p-6 shadow-2xl"
            >
              <div>
                <div className="flex items-start justify-between border-b border-soft-line pb-4">
                  <div>
                    <h4 className="m-0 text-base font-bold text-soft-ink">
                      Configurador Soft UI
                    </h4>
                    <p className="mt-1 text-xs text-soft-muted">
                      Personaliza el estilo visual del panel BotHub
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfiguratorOpen(false)}
                    aria-label="Cerrar configurador"
                    className="grid min-h-[44px] min-w-[44px] place-items-center rounded-lg p-1 text-soft-muted hover:text-soft-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-6">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-soft-ink">
                    Color del Sidebar Activo
                  </h5>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {ACCENT_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setAccentColor(option.id)}
                        title={option.label}
                        aria-label={option.label}
                        className={cn(
                          'h-8 w-8 rounded-full transition-transform duration-200 hover:scale-110',
                          option.previewClass,
                          accentColor === option.id
                            ? 'ring-2 ring-soft-ink ring-offset-2 ring-offset-soft-card scale-110'
                            : 'opacity-80'
                        )}
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-7">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-soft-ink">
                    Modo de Tema
                  </h5>
                  <p className="mt-1 text-xs text-soft-muted">
                    Alterna entre esquema claro, oscuro o automático del sistema
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {SCHEME_OPTIONS.map((scheme) => {
                      const Icon = scheme.icon;
                      const isSelected = preference === scheme.id;
                      return (
                        <button
                          key={scheme.id}
                          type="button"
                          onClick={() => setPreference(scheme.id)}
                          className={cn(
                            'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-bold transition-all',
                            isSelected
                              ? 'border-transparent bg-brand-gradient text-white shadow-brand-icon'
                              : 'border-soft-line bg-soft-bg text-soft-muted hover:text-soft-ink'
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          <span>{scheme.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-soft-line bg-soft-bg p-4 text-xs text-soft-muted">
                <strong className="block font-bold text-soft-ink">
                  BotHub Fase 1 · Soft UI
                </strong>
                <span className="mt-1 block">
                  Soporte multi-sesión Baileys + WhatsApp Cloud API + Chatwoot.
                </span>
              </div>
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
