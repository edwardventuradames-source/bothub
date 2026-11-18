import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import { env } from './config/env.js';
import { registerJwtPlugin } from './plugins/jwt.js';
import { registerSwaggerPlugin } from './plugins/swagger.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false
  });

  await app.register(fastifyCors, {
    origin: env.CORS_ORIGIN.split(','),
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

  return app;
}
