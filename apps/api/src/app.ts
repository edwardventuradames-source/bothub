import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import { env } from './config/env.js';
import { registerJwtPlugin } from './plugins/jwt.js';
import { registerSwaggerPlugin } from './plugins/swagger.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerBotsRoutes } from './modules/bots/bots.routes.js';
import { registerFlowsRoutes } from './modules/flows/flows.routes.js';
import { registerPlatformRoutes } from './modules/platform/platform.routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false
  });

  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      const rawBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
      request.rawBody = rawBuffer;
      if (rawBuffer.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(rawBuffer.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  const corsOrigins = env.CORS_ORIGIN.split(',').map((item) => item.trim());
  const allowAnyOrigin = corsOrigins.includes('*');

  await app.register(fastifyCors, {
    origin: allowAnyOrigin ? true : corsOrigins,
    credentials: true
  });

  await registerSwaggerPlugin(app);
  await registerJwtPlugin(app);

  app.get(
    '/api/health',
    {
      schema: {
        tags: ['System'],
        summary: 'Estado del servicio BotHub API'
      }
    },
    async () => ({
      status: 'ok',
      service: 'bothub-api',
      timestamp: new Date().toISOString()
    })
  );

  await app.register(registerAuthRoutes, { prefix: '/api/auth' });
  await app.register(registerBotsRoutes, { prefix: '/api/bots' });
  await app.register(registerFlowsRoutes, { prefix: '/api/flows' });
  await app.register(registerPlatformRoutes, { prefix: '/api' });

  return app;
}
