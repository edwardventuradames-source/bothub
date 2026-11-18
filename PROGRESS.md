# PROGRESS.md — Registro de Avance de BotHub

## Estado General
- **Plataforma BotHub (Fases 1 a 6)**: Completada, compilada, probada con Vitest y publicada en GitHub (`https://github.com/edwardventuradames-source/bothub`)

## Fases Completadas
- [x] **Fase 1**: Estructura Monorepo (`@bothub/shared`, `@bothub/api`, `@bothub/web`), Docker (`docker-compose.yml`, Dockerfiles), Prisma + PostgreSQL, Cifrado `AES-256-GCM`, Autenticación JWT + Refresh Tokens y Layout Soft UI Dashboard.
- [x] **Fase 2**: CRUD de Bots (crear, editar, duplicar, pausar/reanudar, eliminar) + `WhatsAppProvider` (`BaileysDriver` con sesión cifrada `AES-256-GCM` y QR en vivo por Socket.IO).
- [x] **Fase 3**: Integración Bidireccional con Chatwoot (credenciales cifradas, botón "Probar conexión", webhook saliente con verificación en tiempo constante, handoff automático con nota privada y comando `#bot`).
- [x] **Fase 4**: Motor de Flujos (12 tipos de nodos, validación de cédula/correo/número/fecha, variables `{{nombre}}` / `{{cedula}}`, horarios y FAQ) + Editor Visual en React Flow + Simulador interactivo de chat.
- [x] **Fase 5**: Dashboard con métricas en tiempo real, Visor de Conversaciones con trazabilidad de nodos, Contactos con variables capturadas, Consola de Logs en vivo y Usuarios/Roles RBAC (`ADMIN`, `OPERATOR`, `VIEWER`).
- [x] **Fase 6**: Driver oficial `CloudApiDriver` (WhatsApp Cloud API de Meta con verificación de webhook `hub.challenge`), API Keys, Webhooks salientes, Tests Vitest (`9 passed`) y documentación de despliegue en Ubuntu AWS.
