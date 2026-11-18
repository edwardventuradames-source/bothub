# BotHub — Plataforma Multi-Sesión de Bots de WhatsApp + Chatwoot

**BotHub** es una plataforma completa para crear, configurar, conectar y administrar múltiples bots de WhatsApp (mediante **Baileys Multi-Device con QR en vivo** o **WhatsApp Cloud API Oficial de Meta**) integrados bidireccionalmente con **Chatwoot**, diseñada bajo el sistema visual **Soft UI Dashboard**.

---

## 🚀 Características Principales (Fases 1 a 6)

1. **Dashboard Soft UI en Tiempo Real (`/`)**:
   - Tarjetas KPI con contadores animados, gráficas de barras y líneas, selector de rango temporal y tabla de bots conectados.
   - Personalizador flotante (**UI Configurator**) con modo Claro/Oscuro y 5 colores de acento.
2. **Gestión de Bots y Conexión WhatsApp (`/bots`)**:
   - Crear, editar, duplicar, pausar/reanudar y eliminar bots.
   - **Pestaña WhatsApp QR / Cloud API**: Generación de código QR en vivo (Baileys) con simulación de escaneo instantáneo y configuración de credenciales de WhatsApp Cloud API cifradas con `AES-256-GCM`.
   - **Pestaña Chatwoot**: Configuración de `baseUrl`, `accountId`, `inboxId`, `apiAccessToken` cifrado, `webhookToken` y botón **Probar Conexión**.
   - **Pestaña Flujo, Horarios y FAQ**: Asignación de flujo activo, horarios de atención por día y respuestas rápidas por palabras clave.
3. **Constructor Visual de Flujos con React Flow (`/flows`)**:
   - Lienzo visual interactivo (`@xyflow/react`) con MiniMap, controles de zoom y conexión libre de nodos.
   - **Paleta de 12 Tipos de Nodos**: `TRIGGER`, `MESSAGE`, `QUESTION` (con validación de cédula, correo, número, fecha y texto), `BUTTONS`, `LIST`, `CONDITION`, `HTTP_REQUEST`, `AI_PROMPT`, `ASSIGN_TAG`, `DELAY`, `HANDOFF`, `END`.
   - **Inspector de Propiedades en Vivo**: Edita textos, variables `{{nombre}}`, `{{cedula}}`, URLs HTTP, prompts de IA y plantillas de handoff haciendo clic en cualquier nodo.
   - **Guardado de Borrador y Publicación de Versiones (`v1`, `v2`, `v3`...)**.
   - **Probador Interactivo Integrado (WhatsApp Sandbox)**: Chatea en tiempo real con tu flujo, haz clic en botones interactivos y observa las variables capturadas y los nodos ejecutados paso a paso.
4. **Conversaciones y Trazabilidad (`/conversations`)**:
   - Visor sincronizado con Chatwoot con trazabilidad del nodo exacto ejecutado en cada mensaje y botones para **Transferir a Chatwoot** o **Devolver Control al Bot (`#bot`)**.
5. **Directorio de Contactos (`/contacts`)**:
   - Visualización y edición de variables capturadas por los bots y etiquetas sincronizadas con Chatwoot.
6. **Consola de Logs (`/logs`), Usuarios RBAC (`/users`) y Configuración (`/settings`)**:
   - Eventos estructurados en tiempo real, control de acceso por roles (`ADMIN`, `OPERATOR`, `VIEWER`), generación de API Keys con `CSPRNG` y webhooks salientes.

---

## 🛠️ Ejecución Local Rápida

```bash
# 1. Compilar todos los paquetes del monorepo
npm run build

# 2. Iniciar servidor API + Socket.IO (Puerto 4000)
npm run dev:api

# 3. Iniciar aplicación Web React + Vite (Puerto 5173)
npm run dev:web

# 4. Ejecutar suite completa de tests (Vitest)
npm test
```

- **Panel Web**: `http://localhost:5173/`
- **Credenciales Admin por defecto**: `admin@bothub.local` / `Admin1234!` *(o botón de Acceso Instantáneo en `/login`)*
- **Documentación Swagger OpenAPI**: `http://localhost:4000/docs`
