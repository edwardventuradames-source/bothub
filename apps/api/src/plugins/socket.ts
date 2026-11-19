import { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { runtimeStore } from '../lib/runtime-store.js';
import { JwtUserPayload } from './jwt.js';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
  }
}

export function attachSocketServer(app: FastifyInstance): SocketIOServer {
  const corsOrigins = env.CORS_ORIGIN.split(',').map((item) => item.trim()).filter(Boolean);
  const allowAnyOrigin = corsOrigins.includes('*');

  const io = new SocketIOServer(app.server, {
    cors: {
      origin: allowAnyOrigin ? '*' : corsOrigins,
      credentials: !allowAnyOrigin
    }
  });

  io.use(async (socket, next) => {
    try {
      const authToken =
        typeof socket.handshake.auth?.token === 'string'
          ? socket.handshake.auth.token
          : undefined;
      const headerAuth = socket.handshake.headers.authorization;
      const bearerToken =
        typeof headerAuth === 'string' && headerAuth.startsWith('Bearer ')
          ? headerAuth.slice(7).trim()
          : undefined;
      const rawToken = authToken || bearerToken;

      if (!rawToken) {
        return next(new Error('UNAUTHORIZED'));
      }

      const payload = await app.jwt.verify<JwtUserPayload>(rawToken);
      if (!payload?.sub || !payload?.organizationId) {
        return next(new Error('UNAUTHORIZED'));
      }

      const activeUser = runtimeStore.users.find((u) => u.id === payload.sub);
      if (activeUser && !activeUser.isActive) {
        return next(new Error('UNAUTHORIZED'));
      }

      socket.data.user = payload;
      return next();
    } catch {
      return next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as JwtUserPayload | undefined;
    if (!user?.organizationId) {
      socket.disconnect(true);
      return;
    }

    socket.join(`org:${user.organizationId}`);

    socket.on('bot:subscribe', (botId: string) => {
      if (typeof botId !== 'string' || botId.length === 0) {
        return;
      }
      const belongsToOrg = runtimeStore.bots.some(
        (b) => b.id === botId && b.organizationId === user.organizationId
      );
      if (belongsToOrg) {
        socket.join(`bot:${botId}`);
      }
    });

    socket.on('bot:unsubscribe', (botId: string) => {
      if (typeof botId === 'string' && botId.length > 0) {
        socket.leave(`bot:${botId}`);
      }
    });

    socket.on('disconnect', () => {
      logger.debug({ socketId: socket.id }, 'Socket client disconnected');
    });
  });

  app.decorate('io', io);
  return io;
}
