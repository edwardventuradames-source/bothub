# PROGRESS.md — Registro de Avance de BotHub

## Estado General
- **Plataforma BotHub (Fases 1 a 6)**: Completada, compilada, probada con Vitest y publicada en GitHub (`https://github.com/edwardventuradames-source/bothub`)
- **Auditoría QA Intensiva y Endurecimiento AppSec (Fases QA 0 a 4)**: Completada en entorno local (`13` commits de remediación + entregables QA listos para aprobación final antes de `git push`).

## Fases Completadas
- [x] **Fase 1**: Estructura Monorepo (`@bothub/shared`, `@bothub/api`, `@bothub/web`), Docker (`docker-compose.yml`, Dockerfiles), Prisma + PostgreSQL, Cifrado `AES-256-GCM`, Autenticación JWT + Refresh Tokens y Layout Soft UI Dashboard.
- [x] **Fase 2**: CRUD de Bots (crear, editar, duplicar, pausar/reanudar, eliminar) + `WhatsAppProvider` (`BaileysDriver` con sesión cifrada `AES-256-GCM` y QR en vivo por Socket.IO).
- [x] **Fase 3**: Integración Bidireccional con Chatwoot (credenciales cifradas, botón "Probar conexión", webhook saliente con verificación en tiempo constante, handoff automático con nota privada y comando `#bot`).
- [x] **Fase 4**: Motor de Flujos (12 tipos de nodos, validación de cédula/correo/número/fecha, variables `{{nombre}}` / `{{cedula}}`, horarios y FAQ) + Editor Visual en React Flow + Simulador interactivo de chat.
- [x] **Fase 5**: Dashboard con métricas en tiempo real, Visor de Conversaciones con trazabilidad de nodos, Contactos con variables capturadas, Consola de Logs en vivo y Usuarios/Roles RBAC (`ADMIN`, `OPERATOR`, `VIEWER`).
- [x] **Fase 6**: Driver oficial `CloudApiDriver` (WhatsApp Cloud API de Meta con verificación `hub.challenge`, firma HMAC-SHA256 `X-Hub-Signature-256` y envío real a Graph API), `BaileysDriver` multi-device real con QR en vivo por Socket.IO, motor de flujos multi-turno con `HTTP_REQUEST`, `AI_PROMPT`, `DELAY` y selección interactiva estricta, persistencia híbrida PostgreSQL/Prisma + disco cifrado, aislamiento multi-tenant por organización, API Keys, Webhooks salientes y Tests Vitest (`12 passed`).
- [x] **Fase QA 0 — Reconocimiento y Arquitectura**: Inventario completo de endpoints, modelos, pantallas, variables de entorno y deuda técnica; remediación total de CVEs (`1c166e8`, `0` vulnerabilidades en `npm audit`).
- [x] **Fase QA 1 & 3 — Remediación Funcional y AppSec**:
  - Guard SSRF estricto con bloqueo IPv4/IPv6 completo, prohibición de credenciales embebidas, DNS pinning anti-TOCTOU (`pinnedSafeFetch`) y bloqueo de redirects `3xx` (`e0efa59`, `7ba5e22`).
  - Token de webhook Chatwoot obligatorio, enmascaramiento de secretos en `GET /api/bots` y soporte de edición con tokens en blanco (`9965e23`, `84d8a21`).
  - Socket.IO autenticado con JWT y salas aisladas por `organizationId` (`3c1ea14`).
  - Aislamiento multi-tenant estricto en logs/settings/`flow.botId`, hash SHA-256 de API Keys, RBAC `ADMIN`/`OPERATOR` en simulador y validaciones Zod (`fe40a95`, `7ba5e22`).
  - Helmet/CSP, CORS estricto, `rate-limit` `429`, `trustProxy` privado, revocación JWT persistente `0o600` y fail-closed (`9ad97c6`, `d93c564`, `7ba5e22`).
  - Persistencia de flujos, detección de ciclos, deduplicación `wamid`, resiliencia webhooks, horarios `:00`, fecha calendario real, `toggle-pause` / borrado limpio de bots y separación `chatwoot-inbound.ts` (`6e4b50b`, `5439d0e`, `84d8a21`).
- [x] **Fase QA 2 — QA Visual, UX y Accesibilidad**:
  - Corrección de overflow móvil (`196 px` -> `0 px`), `favicon.svg` (`0` errores `404`), `aria-label` completos en botones e inputs, gráficos Recharts reales en Dashboard, buscador móvil Topbar, vista solo lectura para simulador `VIEWER` y carga diferida `React.lazy` (chunk máximo `390.68 kB`).
  - `54` capturas `before` y `55` capturas `after` en `375px`, `768px`, `1366px` y `1920px` + suite E2E `qa/e2e-audit.mjs` (`e2ePassed: true`).
- [x] **Fase QA 4 — Verificación y Contingencia Revisor (`revisor.md`)**:
  - Ante la ausencia de CLI/modelo Claude en la sesión, la revisión independiente se ejecutó mediante Subagente Revisor (`2fb48813`, `Model: 'pro'`) en dos rondas: Ronda 1 (`RECHAZADO`, `ea3293e`) -> Correcciones (`7ba5e22`, `84d8a21`) -> Ronda 2 (**`APROBADO`**, `0` hallazgos pendientes, `24/24` tests Vitest, `19/19` sondas HTTP/WS en vivo, `npm run build` limpio y `0` vulnerabilidades en `npm audit`).
  - Paquete de verificación para segunda revisión opcional con Claude y decisiones de migración Prisma/PostgreSQL documentadas en [`qa/REPORTE_QA.md`](qa/REPORTE_QA.md).
