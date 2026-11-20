import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './Sidebar.js';
import { Topbar } from './Topbar.js';
import { ThemeConfigurator } from './ThemeConfigurator.js';
import { useAuthStore } from '../../store/auth.store.js';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard · BotHub',
  '/bots': 'Bots de WhatsApp · BotHub',
  '/flows': 'Flujos Conversacionales · BotHub',
  '/conversations': 'Conversaciones · BotHub',
  '/contacts': 'Contactos · BotHub',
  '/logs': 'Logs en Tiempo Real · BotHub',
  '/users': 'Usuarios y Roles · BotHub',
  '/settings': 'Configuración · BotHub'
};

export function AppLayout() {
  const { isAuthenticated } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const location = useLocation();
  const routeTransitionKey = location.pathname.startsWith('/flows')
    ? '/flows'
    : location.pathname;

  useEffect(() => {
    document.title = location.pathname.startsWith('/flows/')
      ? 'Editor Visual de Flujos · BotHub'
      : (PAGE_TITLES[location.pathname] ??
        'BotHub · Plataforma de Bots de WhatsApp & Chatwoot');
    setSearchQuery('');
  }, [location.pathname]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="grid min-h-screen grid-cols-1 gap-6 p-4 lg:grid-cols-[250px_1fr]">
      <Sidebar
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <main className="flex min-w-0 flex-col gap-6 pb-24">
        <Topbar
          onOpenMobileSidebar={() => setMobileOpen(true)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        <AnimatePresence mode="wait">
          <motion.div
            key={routeTransitionKey}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="flex min-w-0 flex-col gap-6"
          >
            <Outlet context={{ searchQuery }} />
          </motion.div>
        </AnimatePresence>
      </main>

      <ThemeConfigurator />
    </div>
  );
}
