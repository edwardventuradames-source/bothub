import { useEffect, useRef, useState } from 'react';
import { Bell, LogOut, Menu, Search, Settings } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BotLogDto } from '@bothub/shared';
import { useAuthStore } from '../../store/auth.store.js';
import { useThemeStore } from '../../store/theme.store.js';
import { authApi, platformApi } from '../../lib/api.js';

interface TopbarProps {
  onOpenMobileSidebar: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
}

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/bots': 'Bots de WhatsApp',
  '/flows': 'Flujos Conversacionales',
  '/conversations': 'Conversaciones & Trazabilidad',
  '/contacts': 'Directorio de Contactos',
  '/logs': 'Logs y Eventos en Tiempo Real',
  '/users': 'Usuarios y Roles',
  '/settings': 'Configuración General'
};

export function Topbar({
  onOpenMobileSidebar,
  searchQuery,
  onSearchChange
}: TopbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, refreshToken, clearSession } = useAuthStore();
  const { resolvedTheme, toggleLightDark, setConfiguratorOpen } = useThemeStore();
  const [notifOpen, setNotifOpen] = useState(false);
  const [recentLogs, setRecentLogs] = useState<BotLogDto[]>([]);
  const [notifError, setNotifError] = useState<string | null>(null);
  const notifContainerRef = useRef<HTMLDivElement>(null);

  const currentTitle = location.pathname.startsWith('/flows/')
    ? 'Editor Visual de Flujos'
    : (ROUTE_TITLES[location.pathname] ?? 'Dashboard');

  useEffect(() => {
    if (!notifOpen) return;
    let active = true;
    platformApi
      .listLogs({ level: 'ALL' })
      .then(({ logs }) => {
        if (active) {
          setRecentLogs(logs.slice(0, 5));
          setNotifError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setNotifError(err instanceof Error ? err.message : 'No se pudieron cargar alertas.');
        }
      });

    const handleOutside = (event: MouseEvent) => {
      if (
        notifContainerRef.current &&
        !notifContainerRef.current.contains(event.target as Node)
      ) {
        setNotifOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNotifOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      active = false;
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [notifOpen]);

  async function handleLogout(): Promise<void> {
    if (refreshToken) {
      await authApi.logout(refreshToken).catch(() => undefined);
    }
    clearSession();
    navigate('/login');
  }

  return (
    <header className="soft-card flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          aria-label="Abrir menú lateral"
          className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl border border-soft-line p-2 text-soft-ink lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div>
          <small className="block text-xs text-soft-muted">
            🏠 / {currentTitle}
          </small>
          <h3 className="mt-0.5 text-[15px] font-bold text-soft-ink">
            {currentTitle}
          </h3>
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
        <div className="relative w-full sm:w-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft-muted" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar…"
            aria-label="Buscar en BotHub"
            className="min-h-[44px] w-full rounded-[10px] border border-soft-line bg-transparent py-2 pl-9 pr-3.5 text-sm text-soft-ink placeholder:text-soft-muted focus:border-soft-blue focus:outline-none sm:min-h-[38px] sm:w-[210px]"
          />
        </div>

        <button
          type="button"
          onClick={toggleLightDark}
          className="min-h-[44px] rounded-[10px] border border-soft-line bg-soft-card px-3.5 py-2 text-xs font-bold text-soft-ink transition-transform duration-200 hover:-translate-y-0.5 sm:min-h-[38px]"
        >
          {resolvedTheme === 'dark' ? '☀️ Modo claro' : '🌙 Modo oscuro'}
        </button>

        <button
          type="button"
          onClick={() => setConfiguratorOpen(true)}
          aria-label="Personalizar apariencia"
          className="grid min-h-[44px] min-w-[44px] place-items-center rounded-[10px] border border-soft-line bg-soft-card p-2 text-soft-muted transition-colors hover:text-soft-ink sm:min-h-[38px] sm:min-w-[38px]"
        >
          <Settings className="h-4 w-4" />
        </button>

        <div ref={notifContainerRef} className="relative">
          <button
            type="button"
            onClick={() => setNotifOpen((prev) => !prev)}
            aria-label="Notificaciones"
            aria-expanded={notifOpen}
            aria-haspopup="true"
            className="relative grid min-h-[44px] min-w-[44px] place-items-center rounded-[10px] border border-soft-line bg-soft-card p-2 text-soft-muted transition-colors hover:text-soft-ink sm:min-h-[38px] sm:min-w-[38px]"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-soft-success" />
          </button>

          {notifOpen ? (
            <div
              role="region"
              aria-label="Notificaciones recientes"
              className="soft-card absolute right-0 top-12 z-50 w-72 border border-soft-line p-3 shadow-xl sm:w-80"
            >
              <div className="flex items-center justify-between border-b border-soft-line pb-2">
                <strong className="text-xs font-extrabold text-soft-ink">
                  Actividad reciente
                </strong>
                <Link
                  to="/logs"
                  onClick={() => setNotifOpen(false)}
                  className="text-[11px] font-bold text-soft-blue hover:underline"
                >
                  Ver todos
                </Link>
              </div>

              {notifError ? (
                <p className="m-0 py-3 text-xs text-soft-danger">{notifError}</p>
              ) : recentLogs.length === 0 ? (
                <p className="m-0 py-4 text-center text-xs text-soft-muted">
                  Sin eventos recientes registrados.
                </p>
              ) : (
                <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                  {recentLogs.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-xl border border-soft-line bg-soft-bg p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-soft-ink">{item.botName}</span>
                        <span className="text-[10px] font-bold text-soft-blue">
                          {item.level}
                        </span>
                      </div>
                      <p className="m-0 mt-1 text-[11px] text-soft-muted">
                        {item.message}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-soft-line bg-soft-card px-3 py-1.5 sm:min-h-[38px]">
          <span className="text-xs font-bold text-soft-ink">
            👤 {user?.name ?? 'Admin'}
          </span>
          <span className="rounded-md bg-brand-gradient px-1.5 py-0.5 text-[10px] font-bold text-white">
            {user?.role ?? 'ADMIN'}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            className="ml-1 grid min-h-[32px] min-w-[32px] place-items-center rounded-md text-soft-muted transition-colors hover:text-soft-danger"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
