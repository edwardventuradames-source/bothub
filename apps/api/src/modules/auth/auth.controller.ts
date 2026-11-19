import crypto from 'node:crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ForgotPasswordInputSchema,
  LoginInputSchema,
  RefreshTokenInputSchema,
  RegisterInputSchema,
  ResetPasswordInputSchema
} from '@bothub/shared';
import {
  AuthError,
  authenticateWithPassword,
  completePasswordReset,
  createPasswordResetRequest,
  getUserProfileById,
  registerUserAccount,
  revokeAccessTokenJti,
  revokeRefreshToken,
  rotateRefreshToken
} from './auth.service.js';
import { env } from '../../config/env.js';

async function signSessionAccessToken(
  reply: FastifyReply,
  session: { user: { id: string; email: string; role: 'ADMIN' | 'OPERATOR' | 'VIEWER'; organizationId: string }; tokenVersion: number }
): Promise<string> {
  return reply.jwtSign({
    sub: session.user.id,
    email: session.user.email,
    role: session.user.role,
    organizationId: session.user.organizationId,
    jti: crypto.randomUUID(),
    tokenVersion: session.tokenVersion
  });
}

export async function registerHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const parsed = RegisterInputSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Datos de registro inválidos. Verifica nombre, organización, correo y contraseña (mín. 8 caracteres).',
      details: parsed.error.flatten()
    });
    return;
  }

  try {
    const session = await registerUserAccount(parsed.data, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip
    });

    const accessToken = await signSessionAccessToken(reply, session);

    reply.status(201).send({
      accessToken,
      refreshToken: session.rawRefreshToken,
      user: session.user
    });
  } catch (error) {
    if (error instanceof AuthError) {
      reply.status(error.statusCode).send({
        error: error.code,
        message: error.message
      });
      return;
    }
    throw error;
  }
}

export async function loginHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const parsed = LoginInputSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Datos de inicio de sesión inválidos.',
      details: parsed.error.flatten()
    });
    return;
  }

  try {
    const session = await authenticateWithPassword(parsed.data, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip
    });

    const accessToken = await signSessionAccessToken(reply, session);

    reply.status(200).send({
      accessToken,
      refreshToken: session.rawRefreshToken,
      user: session.user
    });
  } catch (error) {
    if (error instanceof AuthError) {
      reply.status(error.statusCode).send({
        error: error.code,
        message: error.message
      });
      return;
    }
    throw error;
  }
}

export async function refreshHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const parsed = RefreshTokenInputSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Refresh token requerido.'
    });
    return;
  }

  try {
    const session = await rotateRefreshToken(parsed.data.refreshToken, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip
    });

    const accessToken = await signSessionAccessToken(reply, session);

    reply.status(200).send({
      accessToken,
      refreshToken: session.rawRefreshToken,
      user: session.user
    });
  } catch (error) {
    if (error instanceof AuthError) {
      reply.status(error.statusCode).send({
        error: error.code,
        message: error.message
      });
      return;
    }
    throw error;
  }
}

export async function logoutHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const parsed = RefreshTokenInputSchema.safeParse(request.body);
  if (parsed.success) {
    await revokeRefreshToken(parsed.data.refreshToken);
  }
  try {
    await request.jwtVerify();
    const payload = request.user as { jti?: string; exp?: number } | undefined;
    revokeAccessTokenJti(payload?.jti, payload?.exp);
  } catch {
    void 0;
  }
  reply.status(200).send({ success: true });
}

export async function currentUserHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const user = await getUserProfileById(request.user.sub);
    reply.status(200).send({ user });
  } catch (error) {
    if (error instanceof AuthError) {
      reply.status(error.statusCode).send({
        error: error.code,
        message: error.message
      });
      return;
    }
    throw error;
  }
}

export async function forgotPasswordHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const parsed = ForgotPasswordInputSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Ingresa un correo electrónico válido.'
    });
    return;
  }

  const result = await createPasswordResetRequest(parsed.data);

  reply.status(200).send({
    success: true,
    message: 'Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña.',
    devResetToken: env.NODE_ENV !== 'production' ? result.resetTokenPreview : undefined
  });
}

export async function resetPasswordHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const parsed = ResetPasswordInputSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Token o nueva contraseña inválidos.'
    });
    return;
  }

  try {
    await completePasswordReset(parsed.data);
    reply.status(200).send({
      success: true,
      message: 'Tu contraseña ha sido actualizada correctamente.'
    });
  } catch (error) {
    if (error instanceof AuthError) {
      reply.status(error.statusCode).send({
        error: error.code,
        message: error.message
      });
      return;
    }
    throw error;
  }
}
