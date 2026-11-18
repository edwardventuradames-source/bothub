import { NavLink } from 'react-router-dom';
import {
  Bot,
  FileText,
  GitBranch,
  KeyRound,
  LayoutGrid,
  MessageSquare,
  Settings,
  Users,
  X
} from 'lucide-react';
import { cn } from '../../lib/utils.js';

interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItemConfig {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  emoji: string;
}

const PRIMARY_NAV_ITEMS: NavItemConfig[] = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid, emoji: '▦' },
  { to: '/bots', label: 'Bots', icon: Bot, emoji: '🤖' },
  { to: '/flows', label: 'Flujos', icon: GitBranch, emoji: '⛓' },
  { to: '/conversations', label: 'Conversaciones', icon: MessageSquare, emoji: '💬' },
  { to: '/contacts', label: 'Contactos', icon: Users, emoji: '👥' }
];

const ACCOUNT_NAV_ITEMS: NavItemConfig[] = [
  { to: '/logs', label: 'Logs', icon: FileText, emoji: '📜' },
  { to: '/users', label: 'Usuarios', icon: KeyRound, emoji: '🔑' },
  { to: '/settings', label: 'Configuración', icon: Settings, emoji: '⚙' }
];

function SidebarContent({ onCloseMobile }: { onCloseMobile?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex items-center justify-between px-4 pt-3 pb-5">
        <div className="flex items-center gap-2.5 font-bold text-[15px] text-soft-ink">
          <i className="grid h-8 w-8 place-items-center rounded-[10px] bg-brand-gradient text-white not-italic shadow-brand-icon">
            🤖
          </i>
          <span>BotHub</span>
        </div>
        {onCloseMobile ? (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Cerrar menú lateral"
            className="rounded-lg p-1.5 text-soft-muted hover:text-soft-ink lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <nav aria-label="Navegación principal" className="flex flex-col gap-1">
        {PRIMARY_NAV_ITEMS.map((item) => {
          const IconComponent = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onCloseMobile}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-xl px-4 py-2.5 font-semibold transition-all duration-200',
                  isActive
                    ? 'bg-soft-card text-soft-ink shadow-soft'
                    : 'text-soft-muted hover:translate-x-1 hover:text-soft-ink'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <b
                    className={cn(
                      'grid h-8 w-8 place-items-center rounded-[10px] text-sm transition-all duration-200',
                      isActive
                        ? 'bg-brand-gradient text-white shadow-brand-icon'
                        : 'bg-soft-card text-soft-ink shadow-nav'
                    )}
                  >
                    <IconComponent className="h-4 w-4" />
                  </b>
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}

        <div className="px-4 pt-4 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-soft-ink opacity-80">
          Account Pages · Cuenta
        </div>

        {ACCOUNT_NAV_ITEMS.map((item) => {
          const IconComponent = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onCloseMobile}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-xl px-4 py-2.5 font-semibold transition-all duration-200',
                  isActive
                    ? 'bg-soft-card text-soft-ink shadow-soft'
                    : 'text-soft-muted hover:translate-x-1 hover:text-soft-ink'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <b
                    className={cn(
                      'grid h-8 w-8 place-items-center rounded-[10px] text-sm transition-all duration-200',
                      isActive
                        ? 'bg-brand-gradient text-white shadow-brand-icon'
                        : 'bg-soft-card text-soft-ink shadow-nav'
                    )}
                  >
                    <IconComponent className="h-4 w-4" />
                  </b>
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-auto rounded-2xl bg-brand-gradient p-4 text-white shadow-soft">
        <strong className="block text-sm font-bold">¿Necesitas ayuda?</strong>
        <div className="mt-0.5 text-xs opacity-90">
          Revisa la documentación y API OpenAPI
        </div>
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          className="mt-2.5 block w-full rounded-[10px] bg-white py-2.5 text-center text-[11px] font-bold uppercase tracking-wide text-[#344767] transition-transform duration-200 hover:-translate-y-0.5"
        >
          DOCUMENTACIÓN
        </a>
      </div>
    </div>
  );
}

export function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
  return (
    <>
      <aside className="sticky top-4 hidden h-[calc(100vh-32px)] self-start lg:flex lg:flex-col">
        <SidebarContent />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <aside className="relative z-10 flex h-full w-[265px] flex-col bg-soft-bg p-4 shadow-2xl">
            <SidebarContent onCloseMobile={onCloseMobile} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
