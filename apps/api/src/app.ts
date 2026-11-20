import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { registerJwtPlugin } from './plugins/jwt.js';
import { registerSwaggerPlugin } from './plugins/swagger.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerBotsRoutes } from './modules/bots/bots.routes.js';
import { registerFlowsRoutes } from './modules/flows/flows.routes.js';
import { registerAiSettingsRoutes } from './modules/platform/ai-settings.routes.js';
import { registerPlatformRoutes } from './modules/platform/platform.routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 1048576,
    trustProxy: [
      '127.0.0.1/32',
      '::1/128',
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      'fc00::/7'
    ]
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

  const corsOrigins = env.CORS_ORIGIN.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const allowAnyOrigin = corsOrigins.includes('*');

  await app.register(fastifyCors, {
    origin: allowAnyOrigin ? '*' : corsOrigins,
    credentials: !allowAnyOrigin
  });

  await app.register(fastifyHelmet, {
    frameguard: { action: 'deny' },
    hsts:
      env.NODE_ENV === 'production'
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    }
  });

  await app.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: 'RATE_LIMIT_EXCEEDED',
      message: `Demasiadas solicitudes. Intenta nuevamente en ${Math.ceil(context.ttl / 1000)} segundos.`
    })
  });

  app.setErrorHandler((error, request, reply) => {
    const errObj = error as {
      statusCode?: unknown;
      code?: unknown;
      error?: unknown;
      message?: unknown;
    };
    const statusCode =
      typeof errObj.statusCode === 'number' ? errObj.statusCode : 500;
    const message =
      typeof errObj.message === 'string' ? errObj.message : 'Solicitud inválida.';
    const code = typeof errObj.code === 'string' ? errObj.code : 'BAD_REQUEST';
    if (statusCode === 429 || errObj.error === 'RATE_LIMIT_EXCEEDED') {
      reply.status(429).send({
        error: 'RATE_LIMIT_EXCEEDED',
        message
      });
      return;
    }
    if (statusCode >= 400 && statusCode < 500) {
      reply.status(statusCode).send({
        error: code,
        message
      });
      return;
    }
    logger.error(
      { path: request.url, method: request.method, err: message },
      'Unhandled API server error'
    );
    reply.status(500).send({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Error interno del servidor.'
    });
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
  await app.register(registerAiSettingsRoutes, { prefix: '/api' });
  await app.register(registerPlatformRoutes, { prefix: '/api' });

  return app;
}
