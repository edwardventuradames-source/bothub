import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './Sidebar.js';
import { Topbar } from './Topbar.js';
import { ThemeConfigurator } from './ThemeConfigurator.js';

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const location = useLocation();

  return (
    <div className="grid min-h-screen grid-cols-1 gap-6 p-4 lg:grid-cols-[250px_1fr]">
      <Sidebar
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <main className="flex min-w-0 flex-col gap-6">
        <Topbar
          onOpenMobileSidebar={() => setMobileOpen(true)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="flex flex-col gap-6"
          >
            <Outlet context={{ searchQuery }} />
          </motion.div>
        </AnimatePresence>
      </main>

      <ThemeConfigurator />
    </div>
  );
}
