import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { UserRole } from '@bothub/shared';
import { env } from '../config/env.js';
import { isAccessTokenValidForUser } from '../modules/auth/auth.service.js';

export interface JwtUserPayload {
  sub: string;
  email: string;
  role: UserRole;
  organizationId: string;
  jti?: string;
  tokenVersion?: number;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUserPayload;
    user: JwtUserPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      allowedRoles: UserRole[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function registerJwtPlugin(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: {
      algorithm: 'HS256',
      expiresIn: env.JWT_ACCESS_EXPIRES_IN
    },
    verify: {
      algorithms: ['HS256']
    }
  });

  app.decorate(
    'authenticate',
    async function authenticateHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      try {
        await request.jwtVerify();
        const isStillValid = await isAccessTokenValidForUser(request.user);
        if (!isStillValid) {
          reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Sesión revocada o usuario inactivo. Inicia sesión nuevamente.'
          });
        }
      } catch {
        reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Token de acceso inválido o expirado. Inicia sesión.'
        });
      }
    }
  );

  app.decorate('requireRole', function requireRoleFactory(allowedRoles: UserRole[]) {
    return async function roleGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      await app.authenticate(request, reply);
      if (reply.sent) {
        return;
      }
      if (!allowedRoles.includes(request.user.role)) {
        reply.status(403).send({
          error: 'FORBIDDEN',
          message: 'No tienes permisos suficientes para realizar esta acción.'
        });
      }
    };
  });
}
