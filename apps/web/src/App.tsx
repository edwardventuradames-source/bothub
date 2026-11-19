import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from './components/layout/AppLayout.js';

const LoginPage = lazy(() =>
  import('./pages/LoginPage.js').then((m) => ({ default: m.LoginPage }))
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/ForgotPasswordPage.js').then((m) => ({
    default: m.ForgotPasswordPage
  }))
);
const DashboardPreviewPage = lazy(() =>
  import('./pages/DashboardPreviewPage.js').then((m) => ({
    default: m.DashboardPreviewPage
  }))
);
const BotsPage = lazy(() =>
  import('./pages/BotsPage.js').then((m) => ({ default: m.BotsPage }))
);
const FlowsBuilderPage = lazy(() =>
  import('./pages/FlowsBuilderPage.js').then((m) => ({
    default: m.FlowsBuilderPage
  }))
);
const ConversationsPage = lazy(() =>
  import('./pages/ConversationsPage.js').then((m) => ({
    default: m.ConversationsPage
  }))
);
const ContactsPage = lazy(() =>
  import('./pages/ContactsPage.js').then((m) => ({ default: m.ContactsPage }))
);
const LogsConsolePage = lazy(() =>
  import('./pages/LogsConsolePage.js').then((m) => ({
    default: m.LogsConsolePage
  }))
);
const UsersRbacPage = lazy(() =>
  import('./pages/UsersRbacPage.js').then((m) => ({ default: m.UsersRbacPage }))
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage.js').then((m) => ({ default: m.SettingsPage }))
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

function PageLoadingFallback() {
  return (
    <div className="grid min-h-[240px] place-items-center text-xs font-bold text-soft-muted">
      Cargando módulo...
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <Suspense fallback={<PageLoadingFallback />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<DashboardPreviewPage />} />
                <Route path="/bots" element={<BotsPage />} />
                <Route path="/flows" element={<FlowsBuilderPage />} />
                <Route path="/flows/:flowId" element={<FlowsBuilderPage />} />
                <Route path="/conversations" element={<ConversationsPage />} />
                <Route path="/contacts" element={<ContactsPage />} />
                <Route path="/logs" element={<LogsConsolePage />} />
                <Route path="/users" element={<UsersRbacPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  );
}
