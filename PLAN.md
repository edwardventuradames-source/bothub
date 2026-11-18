# PLAN.md — Arquitectura y Plan Maestro de BotHub

## 1. Visión General de Arquitectura

**BotHub** es una plataforma multi-tenant y multi-sesión de bots de WhatsApp integrada bidireccionalmente con **Chatwoot**, compuesta por un monorepo con tres paquetes principales:

- `packages/shared`: Esquemas de validación Zod, contratos de DTOs, enumeraciones de estados, tipos de nodos del motor de flujos y utilidades compartidas entre backend y frontend.
- `apps/api`: API REST + WebSocket (Fastify + Socket.IO + TypeScript + Prisma + PostgreSQL + Redis/BullMQ + Swagger/OpenAPI). Incluye cifrado autenticado `AES-256-GCM` para credenciales en reposo, autenticación JWT con rotación de Refresh Tokens y `bcrypt`, y arquitectura modular (`auth`, `bots`, `whatsapp`, `chatwoot`, `flows`, `conversations`, `contacts`, `logs`, `users`).
- `apps/web`: Panel web SPA en React 18 + Vite + TypeScript + TailwindCSS + componentes Radix/shadcn + Framer Motion + TanStack Query + Zustand + Recharts + React Flow, diseñado fielmente bajo la línea estética **Soft UI Dashboard** con soporte completo de modo claro/oscuro, accesibilidad y `prefers-reduced-motion`.

---

## 2. Desglose por Fases y Clasificación de Subtareas

### Fase 1: Estructura Monorepo, Docker, Base de Datos, Autenticación y Layout Soft UI (ACTUAL)
- **[1.1] Scaffolding Monorepo & Configuración Base** (`economico` / `medio`)
  - Archivos: `package.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `docker-compose.yml`, `apps/api/Dockerfile`, `apps/web/Dockerfile`.
  - Criterio de aceptación: Monorepo con npm workspaces funcional, contenedores definidos para `postgres`, `redis`, `api` y `web`, `.env.example` con variables documentadas y valores sensibles vacíos.
- **[1.2] Esquema Compartido (`packages/shared`)** (`medio`)
  - Archivos: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/schemas/auth.schema.ts`, `packages/shared/src/schemas/bot.schema.ts`, `packages/shared/src/schemas/flow.schema.ts`.
  - Criterio de aceptación: Esquemas Zod exportados y tipados para autenticación, roles (`ADMIN`, `OPERATOR`, `VIEWER`), bots, drivers de WhatsApp (`BAILEYS`, `CLOUD_API`) y nodos de flujos.
- **[1.3] Modelo de Datos Prisma & Criptografía (`apps/api`)** (`premium` / `medio`)
  - Archivos: `apps/api/prisma/schema.prisma`, `apps/api/prisma/seed.ts`, `apps/api/src/lib/crypto.ts`, `apps/api/src/lib/prisma.ts`, `apps/api/src/lib/redis.ts`, `apps/api/src/lib/logger.ts`.
  - Criterio de aceptación: Esquema completo multi-tenant (`Organization`, `User`, `RefreshToken`, `PasswordResetToken`, `Bot`, `WhatsAppSession`, `ChatwootConfig`, `Flow`, `FlowVersion`, `Contact`, `Conversation`, `Message`, `QuickReply`, `BusinessHours`, `BotLog`, `ApiKey`, `WebhookConfig`). Cifrado `AES-256-GCM` con IV aleatorio de 12 bytes y authTag de 16 bytes. Seed con organización inicial, usuario admin y bot de ejemplo con flujo de menú.
- **[1.4] Módulo de Autenticación JWT + Refresh Tokens + Recuperación + Socket.IO + OpenAPI (`apps/api`)** (`medio`)
  - Archivos: `apps/api/src/config/env.ts`, `apps/api/src/plugins/jwt.ts`, `apps/api/src/plugins/socket.ts`, `apps/api/src/plugins/swagger.ts`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/modules/auth/auth.routes.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`.
  - Criterio de aceptación: Endpoints `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/forgot-password`, `/api/auth/reset-password`, documentación Swagger en `/docs` y tests unitarios de criptografía y autenticación con Vitest.
- **[1.5] Frontend React + Soft UI Dashboard Layout + Login Animado (`apps/web`)** (`medio`)
  - Archivos: `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/tailwind.config.js`, `apps/web/src/index.css`, `apps/web/src/store/auth.store.ts`, `apps/web/src/store/theme.store.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/components/layout/Sidebar.tsx`, `apps/web/src/components/layout/Topbar.tsx`, `apps/web/src/components/layout/ThemeConfigurator.tsx`, `apps/web/src/components/layout/AppLayout.tsx`, `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/pages/ForgotPasswordPage.tsx`, `apps/web/src/pages/DashboardPreviewPage.tsx`, `apps/web/src/App.tsx`.
  - Criterio de aceptación: Diseño idéntico a Soft UI Dashboard (`#F8F9FA`, sidebar fijo con ítems en cuadro blanco elevado y activo con degradado `#2152FF -> #21D4FD`, tarjeta de ayuda inferior, topbar flotante con breadcrumb/buscador/tema/usuario, botón circular flotante de configuración, tarjetas KPI con contadores animados, tarjeta hero 3D + tarjeta oscura "Handoff inteligente", gráfica de barras blancas sobre fondo oscuro degradado `#3A416F -> #141727` y gráfica de área/líneas cian y azul oscuro, login y recuperación de contraseña animados con Framer Motion y soporte de modo oscuro y `prefers-reduced-motion`).

---

### Fase 2: CRUD de Bots + Conexión WhatsApp (Baileys) con QR en Vivo
- Abstracción `WhatsAppProvider` + `BaileysDriver` con persistencia de sesión cifrada en PostgreSQL, reconexión exponencial y emisión de eventos Socket.IO (`whatsapp:qr`, `whatsapp:status`).
- Endpoints CRUD de Bots (`/api/bots`, duplicar, pausar/activar, eliminar, conectar/desconectar).
- Vista de tarjetas de Bots en vivo + Detalle de Bot con pestaña de conexión QR animada en tiempo real.

### Fase 3: Integración Bidireccional con Chatwoot
- Servicio cliente de Chatwoot con credenciales cifradas (`AES-256-GCM`) y botón "Probar conexión".
- Flujo entrante (WhatsApp -> Contacto/Conversación/Mensaje en Chatwoot con adjuntos).
- Flujo saliente (Webhook de Chatwoot con verificación de token en tiempo constante y prevención de loops -> Envío por WhatsApp).
- Handoff bot -> agente (`pending` -> `open`, nota privada con resumen de variables recolectadas, etiquetas y comando de retorno al bot).

### Fase 4: Motor de Flujos + Editor Visual React Flow + Probador
- Motor de ejecución de grafos con soporte para todos los tipos de nodos (`trigger`, `message`, `buttons`, `list`, `question`, `condition`, `delay`, `http`, `tag`, `handoff`, `ai`, `end`), validación de respuestas (texto, número, correo, cédula, fecha), interpolación de variables `{{variable}}`, horarios de atención y respuestas rápidas FAQ.
- Editor visual React Flow con guardado automático, versiones borrador/publicada y simulador de chat interactivo en el navegador.

### Fase 5: Dashboard Real, Logs en Tiempo Real, Conversaciones, Contactos y Roles
- Agregaciones de métricas reales en Dashboard, visor de conversaciones en solo lectura con trazabilidad de nodos ejecutados, directorio de contactos con variables capturadas, consola de logs en vivo vía Socket.IO y administración de usuarios/roles (`ADMIN`, `OPERATOR`, `VIEWER`).

### Fase 6: Driver WhatsApp Cloud API, Pulido Final, Tests y Documentación
- `CloudApiDriver` oficial de Meta (verificación y recepción de webhook, envío de texto, multimedia, botones, listas y plantillas).
- Suite de tests en Vitest para motor de flujos y webhooks, README completo de arquitectura y despliegue.
