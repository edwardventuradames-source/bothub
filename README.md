# BotHub — Plataforma de Bots de WhatsApp Integrada con Chatwoot

Plataforma full-stack multi-tenant y multi-sesión para crear, configurar y administrar bots de WhatsApp (vía **Baileys QR** y **WhatsApp Cloud API**) con integración bidireccional con **Chatwoot**, constructor visual de flujos en **React Flow** y panel de administración con diseño **Soft UI Dashboard**.

## Estructura del Monorepo

```text
/bothub
  /apps/api        # Backend Fastify + TypeScript + Prisma + BullMQ + Socket.IO + OpenAPI
  /apps/web        # Frontend React 18 + Vite + TailwindCSS + Framer Motion + Soft UI Dashboard
  /packages/shared # Esquemas Zod y tipos TypeScript compartidos
  docker-compose.yml
  .env.example
  PLAN.md
  PROGRESS.md
```

## Requisitos Previos

- **Node.js** 20+
- **Docker** y **Docker Compose** (para PostgreSQL 16 y Redis 7)

## Inicio Rápido en Local

1. Copiar variables de entorno y completar los secretos locales:
   ```bash
   cp .env.example .env
   ```
2. Levantar PostgreSQL y Redis con Docker:
   ```bash
   docker compose up -d postgres redis
   ```
3. Instalar dependencias y compilar paquetes:
   ```bash
   npm install
   npm run db:generate
   npm run build
   ```
4. Ejecutar migraciones y seed inicial:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
5. Iniciar servidores en modo desarrollo:
   ```bash
   npm run dev:api
   npm run dev:web
   ```
   - Panel Web: `http://localhost:5173`
   - API & Documentación Swagger OpenAPI: `http://localhost:4000/docs`

---

## Despliegue en Servidor Ubuntu (AWS EC2 / Lightsail)

### 1. Preparar Ubuntu (22.04 LTS / 24.04 LTS)
Conectarse por SSH a la instancia de AWS (`ssh -i llave.pem ubuntu@<IP_ELASTICA>`):

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker
```

Configurar 2 GB de memoria Swap (recomendado en instancias de 2 GB o 4 GB de RAM):
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2. Clonar y Configurar `.env` en Ubuntu
```bash
git clone <URL_DEL_REPOSITORIO> ~/bothub
cd ~/bothub
cp .env.example .env
```

Generar secretos criptográficos seguros en Ubuntu y asignarlos en `.env`:
- `JWT_ACCESS_SECRET`: `openssl rand -hex 32`
- `JWT_REFRESH_SECRET`: `openssl rand -hex 32`
- `ENCRYPTION_KEY_HEX`: `openssl rand -hex 32`
- `POSTGRES_PASSWORD`: `openssl rand -hex 24`
- `DATABASE_URL`: `postgresql://bothub:<TU_POSTGRES_PASSWORD>@postgres:5432/bothub`
- `REDIS_URL`: `redis://redis:6379`
- `CORS_ORIGIN`: `https://bothub.tudominio.com`

### 3. Levantar la Plataforma con Docker Compose
```bash
docker compose up -d --build
docker compose exec api npx tsx prisma/seed.ts
```

### 4. Configurar HTTPS con Nginx + Certbot (o Caddy) en Ubuntu
Con **Nginx + Certbot** en Ubuntu:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```
Crear `/etc/nginx/sites-available/bothub`:
```nginx
server {
    listen 80;
    server_name bothub.tudominio.com;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Activar sitio y emitir certificado SSL gratuito:
```bash
sudo ln -s /etc/nginx/sites-available/bothub /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d bothub.tudominio.com
```
