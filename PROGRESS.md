# PROGRESS.md — Registro de Avance de BotHub

## Estado General
- **Fase Actual**: Fase 1 — Estructura, Docker, BD, Autenticación y Layout Soft UI Dashboard
- **Estado**: Fase 1 Completada (Pendiente de confirmación del usuario para iniciar Fase 2)

## Subtareas de Fase 1
- [x] `PLAN.md` creado con arquitectura completa de las 6 fases
- [x] `[1.1]` Scaffolding Monorepo, Docker (`docker-compose.yml`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/web/nginx.conf`) y `.env.example`
- [x] `[1.2]` Paquete compartido `@bothub/shared` (Esquemas Zod y tipos TypeScript para Auth, Bots y Flujos)
- [x] `[1.3]` Modelo Prisma multi-tenant (`apps/api/prisma/schema.prisma`), cifrado `AES-256-GCM` (`apps/api/src/lib/crypto.ts`) y script de `seed` (`apps/api/prisma/seed.ts`)
- [x] `[1.4]` Backend Fastify: Autenticación JWT + Refresh Token + Recuperación + Socket.IO + Swagger OpenAPI (`/docs`) + Tests Vitest (`crypto.test.ts` y `app.test.ts`)
- [x] `[1.5]` Frontend React 18 + Vite + TailwindCSS + Framer Motion: Login animado, Recuperación de contraseña y Layout Soft UI Dashboard con vista previa interactiva, contadores animados, gráficas de barras/líneas, configurador flotante de temas y soporte `prefers-reduced-motion`
