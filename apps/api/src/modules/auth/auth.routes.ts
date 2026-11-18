import { FastifyInstance } from 'fastify';
import {
  currentUserHandler,
  forgotPasswordHandler,
  loginHandler,
  logoutHandler,
  refreshHandler,
  resetPasswordHandler
} from './auth.controller.js';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Autenticar usuario con correo y contraseña'
      }
    },
    loginHandler
  );

  app.post(
    '/refresh',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Rotar refresh token y obtener nuevo access token'
      }
    },
    refreshHandler
  );

  app.post(
    '/logout',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Revocar refresh token activo'
      }
    },
    logoutHandler
  );

  app.get(
    '/me',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Auth'],
        summary: 'Obtener perfil del usuario autenticado'
      }
    },
    currentUserHandler
  );

  app.post(
    '/forgot-password',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Solicitar token de recuperación de contraseña'
      }
    },
    forgotPasswordHandler
  );

  app.post(
    '/reset-password',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Restablecer contraseña con token de recuperación'
      }
    },
    resetPasswordHandler
  );
}
