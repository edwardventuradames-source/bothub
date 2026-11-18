import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { attachSocketServer } from './plugins/socket.js';

async function startServer(): Promise<void> {
  const app = await buildApp();
  attachSocketServer(app);

  await app.listen({
    port: env.PORT,
    host: '0.0.0.0'
  });

  logger.info({ port: env.PORT }, 'BotHub API & Socket.IO server listening');
}

startServer().catch((error: unknown) => {
  logger.error({ err: error }, 'Fatal error starting BotHub server');
  process.exit(1);
});
