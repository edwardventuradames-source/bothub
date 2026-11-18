import { Bell, LogOut, Menu, Search, Settings } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store.js';
import { useThemeStore } from '../../store/theme.store.js';
import { authApi } from '../../lib/api.js';

interface TopbarProps {
  onOpenMobileSidebar: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
}

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/bots': 'Bots de WhatsApp',
  '/flows': 'Editor Visual de Flujos',
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

  const currentTitle = ROUTE_TITLES[location.pathname] ?? 'Dashboard';

  async function handleLogout(): Promise<void> {
    if (refreshToken && refreshToken !== 'demo-refresh-mode-active') {
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
          className="rounded-xl border border-soft-line p-2 text-soft-ink lg:hidden"
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

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft-muted" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar…"
            aria-label="Buscar en BotHub"
            className="w-[200px] max-w-full rounded-[10px] border border-soft-line bg-transparent py-2 pl-9 pr-3.5 text-sm text-soft-ink placeholder:text-soft-muted focus:border-soft-blue focus:outline-none sm:w-[220px]"
          />
        </div>

        <button
          type="button"
          onClick={toggleLightDark}
          className="rounded-[10px] border border-soft-line bg-soft-card px-3.5 py-2 text-xs font-bold text-soft-ink transition-transform duration-200 hover:-translate-y-0.5"
        >
          {resolvedTheme === 'dark' ? '☀️ Modo claro' : '🌙 Modo oscuro'}
        </button>

        <button
          type="button"
          onClick={() => setConfiguratorOpen(true)}
          aria-label="Personalizar apariencia"
          className="rounded-[10px] border border-soft-line bg-soft-card p-2 text-soft-muted transition-colors hover:text-soft-ink"
        >
          <Settings className="h-4 w-4" />
        </button>

        <button
          type="button"
          aria-label="Notificaciones"
          className="relative rounded-[10px] border border-soft-line bg-soft-card p-2 text-soft-muted transition-colors hover:text-soft-ink"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-soft-success" />
        </button>

        <div className="flex items-center gap-2 rounded-[10px] border border-soft-line bg-soft-card px-3 py-1.5">
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
            className="ml-1 text-soft-muted transition-colors hover:text-soft-danger"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
