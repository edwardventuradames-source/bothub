import bcrypt from 'bcryptjs';
import {
  AuthUserDto,
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput
} from '@bothub/shared';
import { prisma } from '../../lib/prisma.js';
import {
  generateRandomOpaqueToken,
  hashOpaqueToken
} from '../../lib/crypto.js';

const BCRYPT_SALT_ROUNDS = 12;
const REFRESH_TOKEN_TTL_DAYS = 7;
const PASSWORD_RESET_TTL_MINUTES = 30;
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_DAY = 24 * 60 * MILLISECONDS_PER_MINUTE;
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(generateRandomOpaqueToken(16), BCRYPT_SALT_ROUNDS);

export class AuthError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(code: string, message: string, statusCode = 401) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface IssuedSessionData {
  user: AuthUserDto;
  rawRefreshToken: string;
}

function mapUserToDto(userRecord: {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  organizationId: string;
  avatarUrl: string | null;
  organization: { name: string };
}): AuthUserDto {
  return {
    id: userRecord.id,
    email: userRecord.email,
    name: userRecord.name,
    role: userRecord.role,
    organizationId: userRecord.organizationId,
    organizationName: userRecord.organization.name,
    avatarUrl: userRecord.avatarUrl
  };
}

export async function authenticateWithPassword(
  input: LoginInput,
  metadata?: { userAgent?: string; ipAddress?: string }
): Promise<IssuedSessionData> {
  const userRecord = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: { organization: true }
  });

  const targetHash = userRecord?.passwordHash ?? DUMMY_BCRYPT_HASH;
  const isPasswordValid = await bcrypt.compare(input.password, targetHash);

  if (!userRecord || !userRecord.isActive || !isPasswordValid) {
    throw new AuthError(
      'INVALID_CREDENTIALS',
      'Credenciales inválidas. Verifica tu correo y contraseña.',
      401
    );
  }

  const rawRefreshToken = generateRandomOpaqueToken(40);
  const tokenHash = hashOpaqueToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY);

  await prisma.$transaction([
    prisma.refreshToken.create({
      data: {
        userId: userRecord.id,
        tokenHash,
        userAgent: metadata?.userAgent,
        ipAddress: metadata?.ipAddress,
        expiresAt
      }
    }),
    prisma.user.update({
      where: { id: userRecord.id },
      data: { lastLoginAt: new Date() }
    })
  ]);

  return {
    user: mapUserToDto(userRecord),
    rawRefreshToken
  };
}

export async function rotateRefreshToken(
  rawRefreshToken: string,
  metadata?: { userAgent?: string; ipAddress?: string }
): Promise<IssuedSessionData> {
  const incomingHash = hashOpaqueToken(rawRefreshToken);
  const existingToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: incomingHash },
    include: {
      user: {
        include: { organization: true }
      }
    }
  });

  if (
    !existingToken ||
    existingToken.revokedAt !== null ||
    existingToken.expiresAt.getTime() <= Date.now() ||
    !existingToken.user.isActive
  ) {
    throw new AuthError(
      'INVALID_REFRESH_TOKEN',
      'La sesión ha expirado. Inicia sesión nuevamente.',
      401
    );
  }

  const nextRawRefreshToken = generateRandomOpaqueToken(40);
  const nextTokenHash = hashOpaqueToken(nextRawRefreshToken);
  const nextExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: existingToken.id },
      data: { revokedAt: new Date() }
    }),
    prisma.refreshToken.create({
      data: {
        userId: existingToken.userId,
        tokenHash: nextTokenHash,
        userAgent: metadata?.userAgent,
        ipAddress: metadata?.ipAddress,
        expiresAt: nextExpiresAt
      }
    })
  ]);

  return {
    user: mapUserToDto(existingToken.user),
    rawRefreshToken: nextRawRefreshToken
  };
}

export async function revokeRefreshToken(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashOpaqueToken(rawRefreshToken);
  await prisma.refreshToken.updateMany({
    where: {
      tokenHash,
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });
}

export async function getUserProfileById(userId: string): Promise<AuthUserDto> {
  const userRecord = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: true }
  });

  if (!userRecord || !userRecord.isActive) {
    throw new AuthError('USER_NOT_FOUND', 'Usuario no encontrado o inactivo.', 404);
  }

  return mapUserToDto(userRecord);
}

export async function createPasswordResetRequest(
  input: ForgotPasswordInput
): Promise<{ resetTokenPreview?: string }> {
  const userRecord = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() }
  });

  if (!userRecord || !userRecord.isActive) {
    return {};
  }

  const rawResetToken = generateRandomOpaqueToken(32);
  const tokenHash = hashOpaqueToken(rawResetToken);
  const expiresAt = new Date(
    Date.now() + PASSWORD_RESET_TTL_MINUTES * MILLISECONDS_PER_MINUTE
  );

  await prisma.passwordResetToken.create({
    data: {
      userId: userRecord.id,
      tokenHash,
      expiresAt
    }
  });

  return {
    resetTokenPreview: rawResetToken
  };
}

export async function completePasswordReset(input: ResetPasswordInput): Promise<void> {
  const tokenHash = hashOpaqueToken(input.token);
  const resetRecord = await prisma.passwordResetToken.findUnique({
    where: { tokenHash }
  });

  if (
    !resetRecord ||
    resetRecord.usedAt !== null ||
    resetRecord.expiresAt.getTime() <= Date.now()
  ) {
    throw new AuthError(
      'INVALID_RESET_TOKEN',
      'El código de recuperación es inválido o ha expirado.',
      400
    );
  }

  const nextPasswordHash = await bcrypt.hash(input.newPassword, BCRYPT_SALT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetRecord.userId },
      data: { passwordHash: nextPasswordHash }
    }),
    prisma.passwordResetToken.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() }
    }),
    prisma.refreshToken.updateMany({
      where: {
        userId: resetRecord.userId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    })
  ]);
}
