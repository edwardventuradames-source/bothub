# Reporte de Auditoría QA Intensiva — BotHub

**Fecha:** 2026-11-19  
**Rama / Línea base vs. Final:** `main` (`0ac826f` → `84d8a21`, 13 commits locales listos para revisión antes de push a producción)  
**Alcance:** Auditoría integral en 4 fases (Reconocimiento/Arquitectura, QA Funcional/Lógico, QA Visual/UX/Accesibilidad en 4 viewports y Ciberseguridad AppSec OWASP Top 10 / ASVS) sobre el monorepo `@bothub/shared`, `@bothub/api` y `@bothub/web`.

---

## 1. Resumen Ejecutivo y Calificaciones

La auditoría intensiva ejecutada contra el entorno local compilado detectó brechas críticas y altas de seguridad (SSRF con bypasses IPv6/TOCTOU, CORS permisivo con credenciales, WebSockets Socket.IO sin autenticación ni aislamiento multi-tenant, bypass de token webhook en Chatwoot, fuga de API Keys, ausencia de rate-limit/headers y fuga de estado en revocación JWT), defectos funcionales de motor de flujos/negocio (reglas de horario `:00`, ciclos infinitos, deduplicación de webhooks, transición errónea al reanudar bots no configurados, pérdida parcial en edición de tokens en blanco) y problemas visuales/accesibilidad (desbordamiento horizontal de `196 px` en `/flows` móvil, ausencia de favicon con `404` en consola, controles sin `aria-label`, gráficos estáticos en Dashboard y chunk JS inicial de `1,142.60 kB`).

Todos los hallazgos bloqueantes fueron corregidos de forma incremental en commits pequeños, verificados con pruebas unitarias/integración (`Vitest`), sondas en vivo (`HTTP + Socket.IO`), suite end-to-end visual en navegador (`Playwright + Chrome` en `375px`, `768px`, `1366px` y `1920px`) y aprobados por el **Revisor Independiente** tras dos rondas de inspección de diff completo.

| Eje de Evaluación | Línea Base (`0ac826f`) | Estado Final (`84d8a21`) | Evidencia Principal |
|---|---:|---:|---|
| **Funcional y Lógica de Negocio** | 6.0 / 10 | **9.5 / 10** | `24/24` tests Vitest, `19/19` sondas API/WS, E2E Playwright `PASS` |
| **Visual, UX y Accesibilidad** | 6.5 / 10 | **9.4 / 10** | `55` capturas post-fix en 4 viewports, `0` overflows, `0` errores de consola/red |
| **Ciberseguridad (AppSec OWASP)** | 3.5 / 10 | **9.3 / 10** | `0` hallazgos Críticos/Altos abiertos, `0` CVEs en `npm audit`, re-auditoría `APROBADO` |
| **Estructura y Clean Code** | 6.8 / 10 | **9.5 / 10** | `0` comentarios añadidos, máximo `796` líneas/archivo (`< 1000`), build limpio sin warnings `>500 kB` |

> **Nota sobre alcance de entorno:** El host Windows local no cuenta con Docker, PostgreSQL ni Redis activos; por ello las pruebas dinámicas se ejecutaron sobre `RuntimeStore` con almacenamiento aislado en sesiones temporales de QA (sin leer ni modificar `apps/api/sessions/`). La lógica de negocio financiera no aplica porque BotHub no implementa módulos de facturación, pagos ni cálculo de impuestos.

---

## 2. Cobertura e Inventario Auditado (Fase 0)

- **Workspaces**: `packages/shared` (`@bothub/shared`), `apps/api` (`@bothub/api`: Fastify 4, Socket.IO 4.8, Zod, Prisma 5, Baileys, Cloud API Graph v21.0, Vitest), `apps/web` (`@bothub/web`: React 18, Vite 8, TailwindCSS, React Router, TanStack Query, Zustand, React Flow, Recharts).
- **Pantallas verificadas (10 vistas × 4 viewports + estados vacíos, error, dark mode, tabs y modales)**:
  `/login`, `/forgot-password`, `/`, `/bots`, `/flows`, `/conversations`, `/contacts`, `/logs`, `/users`, `/settings`.
- **Viewports cubiertos**: Móvil (`375×812`), Tablet (`768×1024`), Laptop (`1366×768`) y Escritorio (`1920×1080`).
- **Superficie API auditada**: Auth (`/api/auth/*`), Bots/Canales (`/api/bots/*`), Flujos & Simulador (`/api/flows/*`), Métricas/Conversaciones/Contactos/Logs/Usuarios/Ajustes (`/api/*`) y Webhooks públicos (`/api/webhooks/chatwoot/:botId`, `/api/webhooks/whatsapp-cloud/:botId`).

---

## 3. Tabla Maestra de Hallazgos

| ID | Módulo | Tipo | Severidad | Ubicación Principal | Estado | Commit | Verificado por |
|---|---|---|---|---|---|---|---|
| **SEC-01** | Auth / Sesiones | Seguridad | **Crítica** | `apps/api/src/modules/auth/auth.service.ts`, `auth.routes.ts`, `plugins/jwt.ts` | Corregido | `9ad97c6`, `7ba5e22` | Antigravity + Revisor (`2fb48813`) + Paquete Claude |
| **SEC-02** | API / CORS / Headers | Seguridad | **Crítica** | `apps/api/src/app.ts`, `docker-compose.yml` | Corregido | `9ad97c6`, `7ba5e22` | Antigravity + Revisor (`2fb48813`) |
| **SEC-03** | Flujos / Chatwoot / Webhooks | Seguridad | **Crítica** | `apps/api/src/lib/ssrf-guard.ts`, `flow.actions.ts`, `chatwoot.client.ts`, `bots.routes.ts` | Corregido | `e0efa59`, `7ba5e22` | Antigravity + Revisor (`2fb48813`) + Paquete Claude |
| **SEC-04** | Webhook Chatwoot & Secretos | Seguridad | **Crítica** | `apps/api/src/modules/chatwoot/chatwoot-inbound.ts`, `bots.routes.ts`, `BotChatwootTab.tsx` | Corregido | `9965e23`, `84d8a21` | Antigravity + Revisor (`2fb48813`) + Paquete Claude |
| **SEC-05** | Socket.IO Tiempo Real | Seguridad | **Crítica** | `apps/api/src/plugins/socket.ts`, `apps/web/src/lib/socket.ts` | Corregido | `3c1ea14`, `9ad97c6` | Antigravity + Revisor (`2fb48813`) |
| **SEC-06** | Multi-Tenant / RBAC / API Keys | Seguridad | **Alta** | `platform.routes.ts`, `flows.routes.ts`, `persistence.ts`, `runtime-store.ts` | Corregido | `fe40a95`, `7ba5e22`, `84d8a21` | Antigravity + Revisor (`2fb48813`) + Paquete Claude |
| **SEC-07** | Webhook Cloud API HMAC | Seguridad | **Alta** | `apps/api/src/modules/whatsapp/cloud-api.driver.ts`, `platform.routes.ts` | Corregido | `9ad97c6`, `d93c564` | Antigravity + Revisor (`2fb48813`) + Paquete Claude |
| **SEC-08** | Motor de Flujos (ReDoS) | Seguridad | **Alta** | `apps/api/src/lib/safe-regex.ts`, `flow.engine.ts` | Corregido | `9ad97c6` | Antigravity + Revisor (`2fb48813`) |
| **SEC-09** | Dependencias npm | Seguridad | **Alta** | `package-lock.json`, `apps/*/package.json`, `packages/shared/package.json` | Corregido | `1c166e8` | Antigravity + Revisor (`2fb48813`) |
| **SEC-10** | Proxy, Permisos Fichero y Zod | Seguridad | **Media** | `app.ts`, `runtime-store.ts`, `platform.routes.ts`, `nginx.conf` | Corregido | `9ad97c6`, `fe40a95`, `7ba5e22` | Antigravity + Revisor (`2fb48813`) |
| **FUNC-01** | Motor de Flujos & Persistencia | Funcional | **Alta** | `apps/api/src/modules/flows/flow.engine.ts`, `persistence.ts`, `inbound-pipeline.ts` | Corregido | `6e4b50b` | Antigravity + Revisor (`2fb48813`) |
| **FUNC-02** | Resiliencia Webhooks & Chatwoot | Funcional | **Alta** | `platform.routes.ts`, `chatwoot.service.ts`, `chatwoot-inbound.ts` | Corregido | `6e4b50b`, `84d8a21` | Antigravity + Revisor (`2fb48813`) |
| **FUNC-03** | Ciclo de Vida Bots | Funcional | **Alta** | `apps/api/src/modules/bots/bots.routes.ts`, `runtime-store.ts` | Corregido | `5439d0e` | Antigravity + Revisor (`2fb48813`) |
| **FUNC-04** | Edición Canal sin Re-ingresar Secretos | Funcional | **Alta** | `BotWhatsAppTab.tsx`, `BotChatwootTab.tsx`, `bot.schema.ts`, `bots.routes.ts` | Corregido | `9965e23`, `5439d0e` | Antigravity + Revisor (`2fb48813`) |
| **FUNC-05** | Horarios `:00` y Pestaña FAQ | Funcional | **Media** | `apps/api/src/lib/bot-runtime-utils.ts`, `BotScheduleFaqTab.tsx` | Corregido | `6e4b50b`, `5439d0e`, `84d8a21` | Antigravity + Revisor (`2fb48813`) |
| **FUNC-06** | Validador `DATE` y Errores Webhook | Funcional | **Media** | `bot-runtime-utils.ts`, `platform.routes.ts`, `chatwoot-inbound.ts` | Corregido | `6e4b50b`, `84d8a21` | Antigravity + Revisor (`2fb48813`) |
| **FUNC-07** | Dashboard Vivo y Controles Topbar | Funcional | **Media** | `runtime-store.ts`, `DashboardPreviewPage.tsx`, `Topbar.tsx`, páginas tabla | Corregido | `6e4b50b`, `e998d67` | Antigravity + Revisor (`2fb48813`) |
| **UX-01** | Responsive Móvil (`/flows`) | Visual/UX | **Alta** | `apps/web/src/pages/FlowsBuilderPage.tsx`, `AppLayout.tsx`, `Topbar.tsx` | Corregido | `e998d67`, `ea3293e` | Antigravity (`375px` verificado) |
| **UX-02** | Favicon / Errores Consola `404` | Visual/UX | **Media** | `apps/web/index.html`, `apps/web/public/favicon.svg` | Corregido | `e998d67` | Antigravity (`e2e-after-metrics.json`) |
| **UX-03** | Accesibilidad y Tokens CSS | Visual/UX | **Media** | `BotsPage.tsx`, `FlowsBuilderPage.tsx`, `UsersRbacPage.tsx`, `ContactsPage.tsx` | Corregido | `e998d67` | Antigravity (`0` controles sin label) |
| **UX-04** | Bundle > 1.1 MB y Código Muerto | Arquitectura/UX | **Media** | `apps/web/src/App.tsx`, `FlowsBuilderPage.tsx`, eliminación `ModulePlaceholderPage.tsx` | Corregido | `e998d67`, `84d8a21` | Antigravity + Revisor (`2fb48813`) |

---

## 4. Detalle Completo por Hallazgo

### Hallazgos de Seguridad (Fase 3)

#### SEC-01 · Crítica · Revocación JWT, fail-closed y preservación de estado de usuario en `PATCH /api/users/:id`
- **Ubicación**: `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/auth.routes.ts`, `apps/api/src/plugins/jwt.ts`, `apps/api/src/modules/platform/platform.routes.ts`.
- **Reproducción**: (1) Al hacer `POST /api/auth/logout`, el access token seguía siendo aceptado por `/api/auth/me` hasta su expiración (`24h`). (2) En una versión intermedia de la remediación, el revisor detectó que `bumpUserTokenVersion()` invocaba `runtimeStore.reloadUsersFromDisk()` antes de persistir, lo que en `PATCH /api/users/:id` podía revertir silenciosamente `isActive: false` o un cambio de `role`, y que `isAccessTokenValidForUser` devolvía `true` si fallaba DB.
- **Esperado vs. Obtenido**: El logout y la suspensión deben invalidar inmediatamente access/refresh tokens (fail-closed) conservando el nuevo estado en memoria/disco sin exponer `tokenVersion` ni `passwordHash`.
- **Corrección (`9ad97c6`, `7ba5e22`)**: Lista negra de `jti` y versión mínima de token persistidas en `token-revocations.json` (`mode: 0o600`, omitido en tests); eliminado el reload destructivo dentro de `bumpUserTokenVersion`; validación estrictamente fail-closed (`return false`) ante usuario ausente o fallo DB; omisión de `tokenVersion` en `GET /api/users`; bloqueo `401` uniforme en relogin de usuarios inactivos.
- **Evidencia**: `SEC-JWT-LOGOUT` en `probe-after.mjs` (`401`); test `security-audit.test.ts` (revoca tras logout y suspensión, `unknown-ghost-sub === false`, `listedUsers[0].tokenVersion === undefined`, `suspendedListed.isActive === false`, relogin `401`).

#### SEC-02 · Crítica · CORS permisivo con credenciales, ausencia de headers HTTP de seguridad y falta de Rate-Limit
- **Ubicación**: `apps/api/src/app.ts`, `docker-compose.yml`.
- **Reproducción**: Enviar `Origin: https://evil-attacker.example` a cualquier endpoint devolvía el origen atacante reflejado con `Access-Control-Allow-Credentials: true`, sin `Content-Security-Policy`, `X-Frame-Options` ni límite de intentos fallidos en `/api/auth/login`.
- **Corrección (`9ad97c6`, `d93c564`, `7ba5e22`)**: Registro de `@fastify/helmet`, política CORS estricta validada contra lista blanca `CORS_ORIGIN`, `@fastify/rate-limit` sobre rutas de autenticación con `errorResponseBuilder` devolviendo código `429` y `trustProxy` acotado a CIDRs privados/loopback (`127.0.0.1/32`, `10.0.0.0/8`, etc.).
- **Evidencia**: `SEC-CORS` (`acao: null`), `SEC-HEADERS` (`x-content-type-options: nosniff`, `x-frame-options: DENY`, `content-security-policy: true`), `SEC-RATELIMIT` (`429`) en `probe-after.mjs` y `security-audit.test.ts`.

#### SEC-03 · Crítica · SSRF con bypasses IPv6, credenciales en URL y DNS Rebinding (TOCTOU)
- **Ubicación**: `apps/api/src/lib/ssrf-guard.ts`, `apps/api/src/modules/flows/flow.actions.ts`, `apps/api/src/modules/chatwoot/chatwoot.client.ts`, `apps/api/src/modules/bots/bots.routes.ts`, `apps/api/src/modules/platform/platform.routes.ts`.
- **Reproducción**: Configurar URLs como `http://0x7f000001:4000`, `http://[::ffff:127.0.0.1]:4000`, `http://[::ffff:0:127.0.0.1]`, `http://[64:ff9b::7f00:1]`, `http://user@127.0.0.1` o `http://169.254.169.254` en nodos `HTTP_REQUEST`, Chatwoot o Webhooks salientes permitía escanear red interna o metadatos cloud. Adicionalmente, resolver DNS antes de llamar `fetch` estándar exponía a ventana TOCTOU.
- **Corrección (`e0efa59`, `7ba5e22`)**: Guard centralizado `expandIpv6Hextets` + `isPrivateOrReservedIp` bloqueando loopback, RFC1918, carrier-grade NAT, metadata link-local, `::/96`, `::ffff:0:0/96`, `::ffff:0:0:0/96`, NAT64 `64:ff9b::`, 6to4 `2002::`, Teredo `2001::`, documentación `2001:db8::`, discard `100::`, ULA y multicast; rechazo explícito de credenciales embebidas; fail-closed ante fallo DNS; `pinnedSafeFetch` con `node:http`/`node:https` fijando la IP validada mediante `lookup`, `servername` TLS y bloqueo de redirecciones `3xx`.
- **Evidencia**: `SEC-SSRF-BYPASS`, `SEC-SSRF-CHATWOOT`, `SEC-SSRF-WEBHOOK` en `probe-after.mjs` y `security-audit.test.ts`.

#### SEC-04 · Crítica · Bypass de autenticación en Webhook de Chatwoot y fuga de secretos en `GET /api/bots`
- **Ubicación**: `apps/api/src/modules/chatwoot/chatwoot-inbound.ts`, `apps/api/src/modules/bots/bots.routes.ts`, `apps/web/src/components/bots/BotChatwootTab.tsx`.
- **Reproducción**: (1) Un atacante podía enviar `POST /api/webhooks/chatwoot/:botId` sin token válido aprovechando coincidencia laxa de `account.id`/`inbox.id`, o enviando `apiAccessToken` en vez de `webhookToken`. (2) El endpoint `GET /api/bots` devolvía campos sensibles completos de Chatwoot/Cloud API al cliente.
- **Corrección (`9965e23`, `84d8a21`)**: Verificación obligatoria y estricta de `webhookToken` en tiempo constante (lanzando `ChatwootWebhookAuthError` -> HTTP `401`) sin aceptar `apiAccessToken` como sustituto; sanitización de respuestas DTO con máscaras booleanas (`hasApiAccessToken`, `hasAccessToken`, etc.) sin emitir tokens reales en `GET`.
- **Evidencia**: `SEC-CW-WEBHOOK-BYPASS` en `probe-after.mjs` y `security-audit.test.ts`.

#### SEC-05 · Crítica · Socket.IO sin verificación JWT ni aislamiento entre organizaciones
- **Ubicación**: `apps/api/src/plugins/socket.ts`, `apps/web/src/lib/socket.ts`, rutas/drivers emisores.
- **Reproducción**: Un cliente Socket.IO sin cabecera ni `auth.token` conectaba al servidor y recibía eventos globales de QR de Baileys, logs y mensajes de otras empresas.
- **Corrección (`3c1ea14`, `9ad97c6`)**: Middleware de handshake obligatorio validando JWT + `isAccessTokenValidForUser`, unión a salas `org:<organizationId>` y emisión filtrada por organización.
- **Evidencia**: `SEC-SOCKET-UNAUTH` en `probe-after.mjs` y suite WebSocket en `security-audit.test.ts`.

#### SEC-06 · Alta · Fuga multi-tenant (IDOR), `flow.botId` entre tenants, RBAC incompleto y API Keys sin hash
- **Ubicación**: `apps/api/src/modules/platform/platform.routes.ts`, `apps/api/src/modules/flows/flows.routes.ts`, `apps/api/src/lib/persistence.ts`, `apps/api/src/lib/runtime-store.ts`.
- **Reproducción**: Logs, API Keys y Webhooks devolvían registros de otras organizaciones; API Keys almacenaban/exponían `rawKeyPreview` después de crearse; `POST /api/flows` y `PUT /api/flows/:id/graph` aceptaban un `botId` perteneciente a otra organización; `POST /api/flows/:id/simulate` permitía ejecución por rol `VIEWER`.
- **Corrección (`fe40a95`, `7ba5e22`, `84d8a21`)**: Filtrado estricto por `organizationId` en settings/logs/persistence (`syncFlowToDb`); hash SHA-256 con prefijo enmascarado tras creación de API Key; restricción `ADMIN` en settings overview; validación de propiedad de `botId` (`404 BOT_NOT_FOUND`) en creación y guardado de flujos; restricción `['ADMIN', 'OPERATOR']` en `/simulate`.
- **Evidencia**: Tests de aislamiento multi-tenant Alpha vs Beta y `VIEWER` en `security-audit.test.ts`.

#### SEC-07 · Alta · Omisión de verificación HMAC en WhatsApp Cloud API en producción
- **Ubicación**: `apps/api/src/modules/whatsapp/cloud-api.driver.ts`, `apps/api/src/modules/platform/platform.routes.ts`.
- **Reproducción**: Con `NODE_ENV=production`, si el bot no tenía configurado `appSecret`, el webhook aceptaba payloads sin cabecera `X-Hub-Signature-256`.
- **Corrección (`9ad97c6`, `d93c564`)**: En producción se exige `appSecret` y firma HMAC válida antes de procesar el payload; en caso contrario retorna `401`.
- **Evidencia**: Test en `security-audit.test.ts` simulando `NODE_ENV=production` con resultado `401`.

#### SEC-08 · Alta · Riesgo de ReDoS en condiciones y preguntas basadas en expresiones regulares
- **Ubicación**: `apps/api/src/lib/safe-regex.ts`, `apps/api/src/modules/flows/flow.engine.ts`.
- **Corrección (`9ad97c6`)**: Validación estructural de patrones (límite de longitud y bloqueo de cuantificadores anidados peligrosos) antes de evaluar en tiempo de ejecución.
- **Evidencia**: Test de payloads `(a+)+$` en `security-audit.test.ts`.

#### SEC-09 · Alta · Vulnerabilidades conocidas en dependencias npm
- **Ubicación**: `package-lock.json` y manifiestos de workspaces (`1c166e8`).
- **Corrección (`1c166e8`)**: Actualización de dependencias vulnerables y configuración de alcance `src/` en Vitest (`vitest.config.ts`).
- **Evidencia**: `npm audit` y `npm audit --omit=dev` devolviendo `found 0 vulnerabilities`.

#### SEC-10 · Media · Hardening de cabeceras proxy, permisos de disco `0o600`, validaciones Zod y Nginx
- **Ubicación**: `apps/api/src/app.ts`, `runtime-store.ts`, `platform.routes.ts`, `apps/web/nginx.conf`.
- **Corrección (`9ad97c6`, `fe40a95`, `7ba5e22`)**: Permisos `0o600` al persistir `users.json`, `runtime-state.json` y `token-revocations.json`; validación Zod en `handoff` (`action`) y `contacts` (`variables`); `trustProxy` con CIDRs privados; cabeceras defensivas en `nginx.conf`.

---

### Hallazgos Funcionales y de Lógica de Negocio (Fase 1)

#### FUNC-01 · Alta · Persistencia de flujos, ciclos infinitos en grafos y deduplicación inbound
- **Ubicación**: `apps/api/src/modules/flows/flow.engine.ts`, `apps/api/src/lib/persistence.ts`, `apps/api/src/modules/whatsapp/inbound-pipeline.ts`.
- **Detalle y Corrección (`6e4b50b`)**: Prevención de bucles infinitos mediante tope de pasos (`MAX_GRAPH_STEPS`), manejo de `isLiveExecution`, sincronización segura hacia DB e idempotencia por `externalMessageId`/`wamid` evitando procesar mensajes duplicados en WhatsApp Cloud API y Baileys.
- **Evidencia**: `FUNC-WEBHOOK-IDEMPOTENCY` (`secondAction: duplicate_message_ignored`, `contactMsgCount: 1`) en `probe-after.mjs` y `qa-functional.test.ts`.

#### FUNC-02 · Alta · HTTP 500 en webhook ante error de envío saliente y fallos silenciosos en Chatwoot
- **Ubicación**: `apps/api/src/modules/platform/platform.routes.ts`, `apps/api/src/modules/chatwoot/chatwoot.service.ts`, `chatwoot-inbound.ts`.
- **Corrección (`6e4b50b`, `84d8a21`)**: El webhook WhatsApp atrapa errores de `sendReply` y responde `200` registrando el incidente para evitar bucles de reintento desde Meta; `outboundForwarder` ejecuta dentro de `try/catch` con evento `chatwoot.outbound.error`; envíos de FAQ, fuera de horario y notas privadas utilizan `sendToChatwootWithLog`.
- **Evidencia**: `qa-functional.test.ts` y `probe-after.mjs`.

#### FUNC-03 · Alta · Estado inconsistente en `toggle-pause` de bots no configurados y residuos tras `DELETE`
- **Ubicación**: `apps/api/src/modules/bots/bots.routes.ts`, `apps/api/src/lib/runtime-store.ts`.
- **Corrección (`5439d0e`)**: Al reanudar un bot sin sesión ni credenciales activas pasa a `DISCONNECTED` en lugar de `CONNECTED`; al eliminar un bot se limpian sus secretos y vínculos de flujo.
- **Evidencia**: `FUNC-TOGGLE-UNCONFIGURED` en `probe-after.mjs` y `qa-functional.test.ts`.

#### FUNC-04 · Alta · Bloqueo al editar configuración Cloud API / Chatwoot dejando tokens existentes en blanco
- **Ubicación**: `BotWhatsAppTab.tsx`, `BotChatwootTab.tsx`, `packages/shared/src/schemas/bot.schema.ts`, `bots.routes.ts`.
- **Corrección (`9965e23`, `5439d0e`)**: Los esquemas y formularios permiten actualizar `phoneNumberId`, `wabaId`, `baseUrl`, etc. con tokens opcionales en edición, preservando en el servidor los secretos previamente guardados.
- **Evidencia**: `FUNC-CW-EDIT-EMPTY-TOKEN` en `probe-after.mjs` (`200`) y `qa-functional.test.ts`.

#### FUNC-05 · Media · Bug de horario `:00` falsy-zero y editor incompleto de Horarios / FAQ
- **Ubicación**: `apps/api/src/lib/bot-runtime-utils.ts`, `apps/web/src/components/bots/BotScheduleFaqTab.tsx`.
- **Corrección (`6e4b50b`, `5439d0e`, `84d8a21`)**: Sustituido `Number(...) || 59` / `|| 23` por validación numérica con `Number.isInteger` en rangos `0..23` y `0..59` (`18:00` ahora evalúa a minuto `1080` y no `1139`); implementada interfaz completa de edición de horarios semanales, mensaje fuera de horario y creación/listado/borrado de FAQs.
- **Evidencia**: Test de `:00` exacto en `qa-functional.test.ts` y captura `qa/screenshots/after/bots_schedule_tab_desktop.png`.

#### FUNC-06 · Media · Validador `DATE` aceptando fechas inválidas y clasificación `401` vs `502` en Chatwoot
- **Ubicación**: `apps/api/src/lib/bot-runtime-utils.ts`, `platform.routes.ts`, `chatwoot-inbound.ts`.
- **Corrección (`6e4b50b`, `84d8a21`)**: Validación estricta de año/mes/día calendario real (rechaza `2026-99-99`) y separación explícita `ChatwootWebhookAuthError` (`401`) frente a `502 WEBHOOK_PROCESSING_ERROR`.

#### FUNC-07 · Media · Métricas vivas en Dashboard y funcionalidad real en notificaciones/buscador Topbar
- **Ubicación**: `apps/api/src/lib/runtime-store.ts`, `apps/web/src/pages/DashboardPreviewPage.tsx`, `Topbar.tsx`, páginas de listado.
- **Corrección (`6e4b50b`, `e998d67`)**: `getDashboardMetrics` calcula contadores reales por organización y series reales; `DashboardPreviewPage` renderiza gráficos con Recharts; el ícono de campana muestra actividad reciente real y la barra de búsqueda filtra dinámicamente en las vistas correspondientes.

---

### Hallazgos Visuales, UX y Accesibilidad (Fase 2)

#### UX-01 · Alta · Desbordamiento horizontal de `196 px` en `/flows` móvil (`375 px`)
- **Evidencia Antes / Después**: En `qa/screenshots/before/flows_mobile.png` (`baseline-ui-report.json`), `/flows@mobile` reportó `horizontalOverflow: true`, `overflowPx: 196` y barra superior apretada en `Topbar.tsx`. Tras `e998d67` y `ea3293e`, `qa/screenshots/after/flows_mobile.png` y `qa/e2e-after-metrics.json` reportan `overflowPx: 0` en las 32 combinaciones ruta × viewport (`overflows: []`).

#### UX-02 · Media · Favicon faltante provocando error HTTP `404` en consola
- **Evidencia Antes / Después**: `baseline-ui-report.json` registró `missingFavicons: true` y error `404 Not Found` en consola al cargar `/login`. Tras agregar `apps/web/public/favicon.svg` y referenciarlo en `index.html` (`e998d67`), `missingFavicons: false` y `consoleErrors: []`.

#### UX-03 · Media · Controles interactivos sin `aria-label` y clases CSS inconsistentes
- **Evidencia Antes / Después**: `baseline-ui-report.json` detectó 4 botones sin etiqueta accesible (`Pausar Bot`, `Duplicar Bot`, `Eliminar Bot`, `Eliminar nodo seleccionado`) y tablas poco legibles en móvil. Se añadieron etiquetas `aria-label` en todos los botones/inputs (`unlabeledButtons: []`, `unlabeledInputsAll: []`), tarjetas móviles en Contactos/Usuarios, soporte completo Dark Mode y limpieza de utilidades `soft-warning` / `backdrop-blur-sm` (`e998d67`).

#### UX-04 · Media · Bundle JS inicial superior a `1.1 MB`, simulador accesible a `VIEWER` en UI y archivo muerto
- **Corrección (`e998d67`, `84d8a21`)**: Eliminado archivo sin uso `ModulePlaceholderPage.tsx`; extraído `FlowDialogs.tsx` manteniendo `FlowsBuilderPage.tsx` bajo 800 líneas (`720` líneas); añadida vista informativa de solo lectura en simulador cuando el rol es `VIEWER`; aplicado `React.lazy` + `Suspense` en `apps/web/src/App.tsx`, reduciendo el chunk máximo en producción a **`390.68 kB`** (`DashboardPreviewPage`, `101.89 kB` gzip) sin advertencias `> 500 kB`.

---

## 5. Resultados de Suites Automatizadas, Capturas y Comandos de Ejecución

### Suites Ejecutadas Tras el Último Cambio de Código
- **Tests automatizados (`Vitest`)**:
  - Comando: `npm test`
  - Resultado: **5 archivos / 24 tests pasando (0 fallos, 0 omitidos)**:
    - `src/lib/crypto.test.ts` (3 tests)
    - `src/app.test.ts` (3 tests)
    - `src/__tests__/flows-and-webhooks.test.ts` (8 tests)
    - `src/__tests__/qa-functional.test.ts` (4 tests — **nuevo**)
    - `src/__tests__/security-audit.test.ts` (6 tests — **nuevo**)
- **Compilación y tipado estricto**:
  - Comandos: `npm run build`, `npx tsc -p apps/api/tsconfig.json --noEmit`, `npx tsc -p apps/web/tsconfig.json --noEmit`
  - Resultado: **Código de salida 0**; Vite compiló 2,413 módulos en `~1 s` con chunk máximo `390.68 kB` (sin warnings).
- **Auditoría de dependencias**:
  - Comandos: `npm audit` y `npm audit --omit=dev`
  - Resultado: **`found 0 vulnerabilities`**.
- **Sondas vivas HTTP + Socket.IO contra `apps/api/dist/server.js`**:
  - Comando (script QA de verificación): `node .../scratch/probe-after.mjs`
  - Resultado: **19/19 checks `PASS`** (`0` fallos).
- **Suite E2E y Captura Visual en Navegador Real (Playwright + Chromium)**:
  - Comando reproducible (con API en `4000` y Web en `5173`): `node qa/e2e-audit.mjs`
  - Artefactos generados:
    - `qa/screenshots/before/` (**54 capturas** de línea base)
    - `qa/screenshots/after/` (**55 capturas** post-corrección en `mobile`, `tablet`, `laptop`, `desktop`, estados vacíos, error, modales, pestañas de bot, simulador y dark mode)
    - `qa/e2e-after-metrics.json`: `totalScreenshots: 55`, `consoleErrors: []`, `pageErrors: []`, `failedRequests: []`, `overflows: []`, `missingFavicons: false`, `brokenImages: []`, `unlabeledButtons: []`, `unlabeledInputsAll: []`, `e2ePassed: true`.

---

## 6. Checklist Final de Verificación

### Lógica y Funcionalidad
- [x] Registro bootstrap único (`201`) + bloqueo posterior `REGISTRATION_LOCKED` (`403`).
- [x] Autenticación JWT, rotación de refresh token, logout y suspensión de usuarios funcionales e inmediatos.
- [x] CRUD de bots (`CHATWOOT`, `BAILEYS`, `CLOUD_API`), `toggle-pause`, duplicación y borrado con limpieza.
- [x] Edición de tokens Chatwoot/Cloud API permitiendo campos en blanco sin sobrescribir secretos previos.
- [x] Editor visual de flujos, versionado, restauración de versiones, validación de fechas/regex/ciclos, simulador vivo y FAQ/horarios `:00`.
- [x] Webhooks Chatwoot y WhatsApp Cloud API idempotentes y resilientes ante fallos de envío saliente.

### Visual, Responsive y Accesibilidad
- [x] Recorrido completo en 4 viewports (`375px`, `768px`, `1366px`, `1920px`) con capturas antes/después guardadas en `/qa/screenshots/`.
- [x] `0 px` de desbordamiento horizontal en todas las pantallas y viewports.
- [x] Favicon válido sin `404` ni errores de consola o red (`consoleErrors: []`, `failedRequests: []`).
- [x] Dark mode, modales, pestañas, estados vacíos y error validados visualmente.
- [x] Todos los botones e inputs interactivos con nombre accesible (`unlabeledButtons: []`, `unlabeledInputsAll: []`).

### Ciberseguridad (OWASP Top 10 / ASVS) y Clean Code
- [x] Protección SSRF completa (IPv4, IPv6 comprimidas/NAT64/Teredo/6to4/ULA, credenciales embebidas, DNS pinning anti-TOCTOU, redirects bloqueados).
- [x] CORS restrictivo, Helmet/CSP, `trustProxy` acotado, `rate-limit` `429` anti fuerza bruta.
- [x] Aislamiento multi-tenant estricto en endpoints REST, Socket.IO y asignación `flow.botId`.
- [x] Secretos cifrados en reposo (`AES-256-GCM`), archivos locales `0o600`, API Keys hasheadas (`SHA-256`), sin secretos en repo/git.
- [x] `0` vulnerabilidades en `npm audit`, `0` comentarios en código modificado y `< 800` líneas por archivo fuente.

---

## 7. Verificaciones de Claude y Dictamen de Contingencia

1. **Contingencia aplicada en entorno local**: Esta sesión no dispone de binario CLI `claude` ni de un modelo `claude-*` seleccionable para subagentes (solo `inherit`, `flash_lite`, `flash`, `pro`). Conforme a la regla operativa de contingencia documentada en `revisor.md` / reglas del workspace, se ejecutó una auditoría independiente con el **Subagente Revisor Independiente (`2fb48813`, `Model: 'pro'`)** en dos rondas formales sobre el diff completo, y se deja empaquetada la lista exacta de puntos críticos para una segunda validación opcional con Claude en despliegue:
   - **Ronda 1 (`0ac826f..ea3293e`) — Dictamen: `RECHAZADO`**: Detectó 1 defecto Crítico (`reloadUsersFromDisk` en `bumpUserTokenVersion`), 2 Altos (`flow.botId` cross-tenant y SSRF DNS Rebinding TOCTOU + IPv6 adicionales) y 3 Medios (`Chatwoot` tamaño/`401` vs `502`/logs, bug horario `:00`, `trustProxy`/`0o600`/bundle JS `>1.1 MB`).
   - **Ronda 2 (`ea3293e..HEAD` tras commits `7ba5e22` y `84d8a21`, y coherencia `0ac826f..HEAD`) — Dictamen: `APROBADO`**: Verificó el cierre efectivo de todos los hallazgos, `24/24` tests Vitest, `npm run build` sin warnings, `npm audit` en `0`, `0` comentarios en el diff y archivos `<= 796` líneas.
2. **Paquete listo para validación puntual con Claude (opcional previo a producción)**:
   - Auth, JWT fail-closed y revocación: `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/plugins/jwt.ts` (`7ba5e22`).
   - Aislamiento multi-tenant y `flow.botId`: `apps/api/src/modules/flows/flows.routes.ts`, `apps/api/src/lib/persistence.ts`, `apps/api/src/plugins/socket.ts` (`3c1ea14`, `7ba5e22`).
   - Guard SSRF y DNS pinning: `apps/api/src/lib/ssrf-guard.ts`, `apps/api/src/modules/flows/flow.actions.ts`, `apps/api/src/modules/chatwoot/chatwoot.client.ts` (`7ba5e22`).
   - Validación HMAC Meta y tokens Chatwoot: `apps/api/src/modules/whatsapp/cloud-api.driver.ts`, `apps/api/src/modules/chatwoot/chatwoot-inbound.ts` (`9965e23`, `84d8a21`).
   - *(Lógica de dinero: No aplica en BotHub.)*

---

## 8. Pendientes para Decisión del Dueño y Recomendaciones a Mediano Plazo

1. **Migración de Esquema Prisma en PostgreSQL (Decisión / Acción Pre-Producción)**:
   - Añadir columna `tokenVersion Int @default(1)` al modelo `User` en `apps/api/prisma/schema.prisma` para que la revocación global de sesiones por usuario sobreviva reinicios en despliegues multi-réplica sin depender de `token-revocations.json`.
   - Evaluar hacer nullable `Flow.botId` en `schema.prisma` (alineándolo con el DTO/runtime actual que permite crear flujos antes de vincularlos a un bot) e incorporar persistencia completa de `ApiKey`, `WebhookConfig` y lista negra de `jti` en PostgreSQL/Redis antes de escalar horizontalmente la API.
   - Ejecutar `prisma migrate deploy` y probar contra PostgreSQL 16 + Redis 7 reales antes de abrir tráfico productivo.
2. **Gestión de Secretos en Producción**:
   - Inyectar explícitamente `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` y `ENCRYPTION_KEY_HEX` vía gestor de secretos / `.env` de servidor (evitando depender del archivo autogenerado `server-secrets.json`) y restringir `CORS_ORIGIN` al dominio real del frontend (nunca `*`).
3. **Colas Asíncronas (`BullMQ`) y Observabilidad**:
   - Mover reintentos de webhooks salientes, envíos hacia Graph API/Chatwoot y expiración por inactividad a colas reales de `BullMQ` sobre Redis para tolerar caídas temporales de terceros sin bloquear hilos HTTP.
4. **Refinamiento UX Móvil Táctil (`Baja`)**:
   - El análisis automatizado en `375px` registró hasta `28` controles auxiliares compactos con alto/ancho inferior a `44 px` (principalmente controles de zoom de React Flow e íconos secundarios). Evaluar ampliarlos en móvil para cumplimiento estricto de área táctil `44×44 px`.
5. **CI/CD Gate**:
   - Automatizar en GitHub Actions la ejecución conjunta de `tsc --noEmit`, `vitest`, `npm audit`, `gitleaks`/`semgrep` y `qa/e2e-audit.mjs` en cada Pull Request.
