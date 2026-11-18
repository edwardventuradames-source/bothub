import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from './components/layout/AppLayout.js';
import { LoginPage } from './pages/LoginPage.js';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.js';
import { DashboardPreviewPage } from './pages/DashboardPreviewPage.js';
import { BotsPage } from './pages/BotsPage.js';
import { FlowsBuilderPage } from './pages/FlowsBuilderPage.js';
import { ConversationsPage } from './pages/ConversationsPage.js';
import { ContactsPage } from './pages/ContactsPage.js';
import { LogsConsolePage } from './pages/LogsConsolePage.js';
import { UsersRbacPage } from './pages/UsersRbacPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<DashboardPreviewPage />} />
              <Route path="/bots" element={<BotsPage />} />
              <Route path="/flows" element={<FlowsBuilderPage />} />
              <Route path="/conversations" element={<ConversationsPage />} />
              <Route path="/contacts" element={<ContactsPage />} />
              <Route path="/logs" element={<LogsConsolePage />} />
              <Route path="/users" element={<UsersRbacPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  );
}
