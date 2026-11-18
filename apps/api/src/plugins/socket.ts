import { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
  }
}

export function attachSocketServer(app: FastifyInstance): SocketIOServer {
  const io = new SocketIOServer(app.server, {
    cors: {
      origin: env.CORS_ORIGIN.split(','),
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    const organizationId = socket.handshake.auth?.organizationId;
    if (typeof organizationId === 'string' && organizationId.length > 0) {
      socket.join(`org:${organizationId}`);
    }

    socket.on('bot:subscribe', (botId: string) => {
      if (typeof botId === 'string' && botId.length > 0) {
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
