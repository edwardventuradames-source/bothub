import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import {
  hydrateStoreFromDatabase,
  initializeRedisIfConfigured,
  syncLogToDb
} from './lib/persistence.js';
import { runtimeStore } from './lib/runtime-store.js';
import { attachSocketServer } from './plugins/socket.js';
import { provisionAdminAccountFromServer } from './modules/auth/auth.service.js';
import { whatsappProvider } from './modules/whatsapp/whatsapp.provider.js';

async function startServer(): Promise<void> {
  await initializeRedisIfConfigured();
  runtimeStore.setLogPersistenceHandler((organizationId, entry) => {
    void syncLogToDb(organizationId, entry);
  });
  await hydrateStoreFromDatabase(runtimeStore);

  const initialEmail = process.env.INITIAL_ADMIN_EMAIL?.trim();
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD;
  if (initialEmail && initialPassword && initialPassword.length >= 8) {
    await provisionAdminAccountFromServer({
      email: initialEmail,
      password: initialPassword,
      name: process.env.INITIAL_ADMIN_NAME?.trim() || 'Administrador Principal',
      organizationName: process.env.INITIAL_ORG_NAME?.trim() || 'Mi Organización'
    });
    logger.info({ email: initialEmail }, 'Initial admin account provisioned from environment');
  }

  const app = await buildApp();
  const io = attachSocketServer(app);
  whatsappProvider.bindSocketServer(io);

  await app.listen({
    port: env.PORT,
    host: '0.0.0.0'
  });

  await whatsappProvider.restorePersistedSessions();

  logger.info({ port: env.PORT }, 'BotHub API & Socket.IO server listening');
}

startServer().catch((error: unknown) => {
  logger.error({ err: error }, 'Fatal error starting BotHub server');
  process.exit(1);
});
