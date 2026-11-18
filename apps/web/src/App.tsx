import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from './components/layout/AppLayout.js';
import { LoginPage } from './pages/LoginPage.js';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.js';
import { DashboardPreviewPage } from './pages/DashboardPreviewPage.js';
import { ModulePlaceholderPage } from './pages/ModulePlaceholderPage.js';

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
              <Route
                path="/bots"
                element={
                  <ModulePlaceholderPage
                    title="Gestión de Bots y Conexión WhatsApp"
                    phaseLabel="Fase 2 · Próximo Bloque"
                    description="CRUD de bots, sesiones simultáneas con Baileys (QR en vivo) y WhatsApp Cloud API."
                    features={[
                      'Tarjetas de bots con estado en vivo por Socket.IO',
                      'Generación y escaneo de QR animado con Baileys',
                      'Pestañas de configuración Chatwoot, Flujos, Horarios y Variables'
                    ]}
                  />
                }
              />
              <Route
                path="/flows"
                element={
                  <ModulePlaceholderPage
                    title="Constructor Visual de Flujos (React Flow)"
                    phaseLabel="Fase 4 · Motor del Bot"
                    description="Canvas visual con guardado automático, versiones borrador/publicada y simulador de chat."
                    features={[
                      '12 tipos de nodos: Disparador, Mensaje, Botones, Lista, Pregunta, Condición, HTTP, IA, Handoff',
                      'Validación de cédula, correo, número, fecha y texto',
                      'Probador interactivo de flujo en tiempo real'
                    ]}
                  />
                }
              />
              <Route
                path="/conversations"
                element={
                  <ModulePlaceholderPage
                    title="Conversaciones y Trazabilidad"
                    phaseLabel="Fase 3 & 5 · Chatwoot Sync"
                    description="Visor en solo lectura con trazabilidad del flujo ejecutado y estado de handoff."
                    features={[
                      'Sincronización entrante/saliente con Chatwoot',
                      'Trazabilidad de nodos ejecutados por mensaje',
                      'Handoff automático con nota privada de resumen'
                    ]}
                  />
                }
              />
              <Route
                path="/contacts"
                element={
                  <ModulePlaceholderPage
                    title="Directorio de Contactos y Variables"
                    phaseLabel="Fase 5 · Datos Capturados"
                    description="Contactos sincronizados con Chatwoot y variables de sesión capturadas por los bots."
                    features={[
                      'Variables dinámicas {{nombre}}, {{telefono}}, {{cedula}}',
                      'Etiquetas y atributos personalizados sincronizados',
                      'Historial de sesiones por contacto'
                    ]}
                  />
                }
              />
              <Route
                path="/logs"
                element={
                  <ModulePlaceholderPage
                    title="Consola de Logs y Eventos en Tiempo Real"
                    phaseLabel="Fase 5 · Observabilidad"
                    description="Stream de eventos vía Socket.IO con filtros por bot, nivel y rango de fechas."
                    features={[
                      'Logs estructurados Pino + persistencia en PostgreSQL',
                      'Filtro instantáneo por nivel INFO, WARN, ERROR, DEBUG',
                      'Auditoría de webhooks y ejecución de nodos'
                    ]}
                  />
                }
              />
              <Route
                path="/users"
                element={
                  <ModulePlaceholderPage
                    title="Usuarios y Control de Roles (RBAC)"
                    phaseLabel="Fase 5 · Seguridad"
                    description="Administración de usuarios de la organización con roles Admin, Operador y Solo lectura."
                    features={[
                      'Roles ADMIN, OPERATOR y VIEWER validados por JWT',
                      'Gestión de sesiones y revocación de Refresh Tokens',
                      'Soporte multi-tenant por organización'
                    ]}
                  />
                }
              />
              <Route
                path="/settings"
                element={
                  <ModulePlaceholderPage
                    title="Configuración, API Keys y Backups"
                    phaseLabel="Fase 1 & 5 · Plataforma"
                    description="Preferencias visuales Soft UI, llaves de API cifradas con AES-256-GCM y webhooks."
                    features={[
                      'Personalización de tema claro/oscuro y acento del sidebar',
                      'Credenciales cifradas en BD con AES-256-GCM',
                      'Gestión de API Keys y exportación de flujos'
                    ]}
                  />
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  );
}
