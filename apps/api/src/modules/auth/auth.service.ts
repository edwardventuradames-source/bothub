import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  AuthUserDto,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput
} from '@bothub/shared';
import { prisma } from '../../lib/prisma.js';
import {
  generateRandomOpaqueToken,
  hashOpaqueToken
} from '../../lib/crypto.js';
import { runtimeStore } from '../../lib/runtime-store.js';

const BCRYPT_SALT_ROUNDS = 12;
const REFRESH_TOKEN_TTL_DAYS = 7;
const PASSWORD_RESET_TTL_MINUTES = 30;
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_DAY = 24 * 60 * MILLISECONDS_PER_MINUTE;
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(generateRandomOpaqueToken(16), BCRYPT_SALT_ROUNDS);

const fallbackRefreshTokens = new Map<
  string,
  { userId: string; expiresAt: number; revoked: boolean }
>();
const fallbackResetTokens = new Map<
  string,
  { userId: string; expiresAt: number; used: boolean }
>();

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
  avatarUrl?: string | null;
  organization: { name: string };
}): AuthUserDto {
  return {
    id: userRecord.id,
    email: userRecord.email,
    name: userRecord.name,
    role: userRecord.role,
    organizationId: userRecord.organizationId,
    organizationName: userRecord.organization.name,
    avatarUrl: userRecord.avatarUrl ?? null
  };
}

function buildSlugFromName(name: string): string {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return `${baseSlug || 'org'}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function registerUserAccount(
  input: RegisterInput,
  metadata?: { userAgent?: string; ipAddress?: string }
): Promise<IssuedSessionData> {
  const normalizedEmail = input.email.toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);
  const rawRefreshToken = generateRandomOpaqueToken(40);
  const tokenHash = hashOpaqueToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY);

  try {
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });
    if (existing) {
      throw new AuthError(
        'EMAIL_ALREADY_REGISTERED',
        'Ya existe una cuenta registrada con este correo electrónico.',
        409
      );
    }

    const organization = await prisma.organization.create({
      data: {
        name: input.organizationName,
        slug: buildSlugFromName(input.organizationName)
      }
    });

    const createdUser = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: normalizedEmail,
        passwordHash,
        name: input.name,
        role: 'ADMIN',
        isActive: true,
        lastLoginAt: new Date()
      },
      include: { organization: true }
    });

    await prisma.refreshToken.create({
      data: {
        userId: createdUser.id,
        tokenHash,
        userAgent: metadata?.userAgent,
        ipAddress: metadata?.ipAddress,
        expiresAt
      }
    });

    const dto = mapUserToDto(createdUser);
    runtimeStore.users.push({
      id: dto.id,
      organizationId: dto.organizationId,
      organizationName: dto.organizationName,
      name: dto.name,
      email: dto.email,
      role: dto.role,
      isActive: true,
      lastLoginAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      passwordHash
    });

    return {
      user: dto,
      rawRefreshToken
    };
  } catch (err) {
    if (err instanceof AuthError) {
      throw err;
    }

    const existsInMem = runtimeStore.users.some(
      (u) => u.email.toLowerCase() === normalizedEmail
    );
    if (existsInMem) {
      throw new AuthError(
        'EMAIL_ALREADY_REGISTERED',
        'Ya existe una cuenta registrada con este correo electrónico.',
        409
      );
    }

    const nowIso = new Date().toISOString();
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();

    const newMemUser = {
      id: userId,
      organizationId,
      organizationName: input.organizationName,
      name: input.name,
      email: normalizedEmail,
      role: 'ADMIN' as const,
      isActive: true,
      lastLoginAt: nowIso,
      createdAt: nowIso,
      passwordHash
    };

    runtimeStore.users.push(newMemUser);
    fallbackRefreshTokens.set(tokenHash, {
      userId,
      expiresAt: expiresAt.getTime(),
      revoked: false
    });

    return {
      user: {
        id: newMemUser.id,
        email: newMemUser.email,
        name: newMemUser.name,
        role: newMemUser.role,
        organizationId: newMemUser.organizationId,
        organizationName: newMemUser.organizationName,
        avatarUrl: null
      },
      rawRefreshToken
    };
  }
}

export async function authenticateWithPassword(
  input: LoginInput,
  metadata?: { userAgent?: string; ipAddress?: string }
): Promise<IssuedSessionData> {
  const normalizedEmail = input.email.toLowerCase();

  try {
    const userRecord = await prisma.user.findUnique({
      where: { email: normalizedEmail },
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
  } catch (err) {
    if (err instanceof AuthError) {
      throw err;
    }

    const fallbackUser = runtimeStore.users.find(
      (user) => user.email.toLowerCase() === normalizedEmail
    );
    const targetHash = fallbackUser?.passwordHash ?? DUMMY_BCRYPT_HASH;
    const isPasswordValid = await bcrypt.compare(input.password, targetHash);

    if (!fallbackUser || !fallbackUser.isActive || !isPasswordValid) {
      throw new AuthError(
        'INVALID_CREDENTIALS',
        'Credenciales inválidas. Verifica tu correo y contraseña.',
        401
      );
    }

    const rawRefreshToken = generateRandomOpaqueToken(40);
    const tokenHash = hashOpaqueToken(rawRefreshToken);
    fallbackRefreshTokens.set(tokenHash, {
      userId: fallbackUser.id,
      expiresAt: Date.now() + REFRESH_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY,
      revoked: false
    });
    fallbackUser.lastLoginAt = new Date().toISOString();

    return {
      user: {
        id: fallbackUser.id,
        email: fallbackUser.email,
        name: fallbackUser.name,
        role: fallbackUser.role,
        organizationId: fallbackUser.organizationId,
        organizationName: fallbackUser.organizationName,
        avatarUrl: null
      },
      rawRefreshToken
    };
  }
}

export async function rotateRefreshToken(
  rawRefreshToken: string,
  metadata?: { userAgent?: string; ipAddress?: string }
): Promise<IssuedSessionData> {
  const incomingHash = hashOpaqueToken(rawRefreshToken);

  try {
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
  } catch (err) {
    if (err instanceof AuthError) {
      throw err;
    }

    const memToken = fallbackRefreshTokens.get(incomingHash);
    const fallbackUser = memToken
      ? runtimeStore.users.find((u) => u.id === memToken.userId)
      : undefined;

    if (!memToken || memToken.revoked || memToken.expiresAt <= Date.now() || !fallbackUser) {
      throw new AuthError(
        'INVALID_REFRESH_TOKEN',
        'La sesión ha expirado. Inicia sesión nuevamente.',
        401
      );
    }

    memToken.revoked = true;
    const nextRawRefreshToken = generateRandomOpaqueToken(40);
    const nextTokenHash = hashOpaqueToken(nextRawRefreshToken);
    fallbackRefreshTokens.set(nextTokenHash, {
      userId: fallbackUser.id,
      expiresAt: Date.now() + REFRESH_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY,
      revoked: false
    });

    return {
      user: {
        id: fallbackUser.id,
        email: fallbackUser.email,
        name: fallbackUser.name,
        role: fallbackUser.role,
        organizationId: fallbackUser.organizationId,
        organizationName: fallbackUser.organizationName,
        avatarUrl: null
      },
      rawRefreshToken: nextRawRefreshToken
    };
  }
}

export async function revokeRefreshToken(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashOpaqueToken(rawRefreshToken);
  try {
    await prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });
  } catch {
    const memToken = fallbackRefreshTokens.get(tokenHash);
    if (memToken) {
      memToken.revoked = true;
    }
  }
}

export async function getUserProfileById(userId: string): Promise<AuthUserDto> {
  try {
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true }
    });

    if (!userRecord || !userRecord.isActive) {
      throw new AuthError('USER_NOT_FOUND', 'Usuario no encontrado o inactivo.', 404);
    }

    return mapUserToDto(userRecord);
  } catch (err) {
    if (err instanceof AuthError) {
      throw err;
    }
    const fallbackUser = runtimeStore.users.find((u) => u.id === userId && u.isActive);
    if (!fallbackUser) {
      throw new AuthError('USER_NOT_FOUND', 'Usuario no encontrado o inactivo.', 404);
    }
    return {
      id: fallbackUser.id,
      email: fallbackUser.email,
      name: fallbackUser.name,
      role: fallbackUser.role,
      organizationId: fallbackUser.organizationId,
      organizationName: fallbackUser.organizationName,
      avatarUrl: null
    };
  }
}

export async function createPasswordResetRequest(
  input: ForgotPasswordInput
): Promise<{ resetTokenPreview?: string }> {
  const normalizedEmail = input.email.toLowerCase();
  try {
    const userRecord = await prisma.user.findUnique({
      where: { email: normalizedEmail }
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
  } catch {
    const fallbackUser = runtimeStore.users.find(
      (u) => u.email.toLowerCase() === normalizedEmail && u.isActive
    );
    if (!fallbackUser) {
      return {};
    }
    const rawResetToken = generateRandomOpaqueToken(32);
    const tokenHash = hashOpaqueToken(rawResetToken);
    fallbackResetTokens.set(tokenHash, {
      userId: fallbackUser.id,
      expiresAt: Date.now() + PASSWORD_RESET_TTL_MINUTES * MILLISECONDS_PER_MINUTE,
      used: false
    });
    return {
      resetTokenPreview: rawResetToken
    };
  }
}

export async function completePasswordReset(input: ResetPasswordInput): Promise<void> {
  const tokenHash = hashOpaqueToken(input.token);
  try {
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
  } catch (err) {
    if (err instanceof AuthError) {
      throw err;
    }
    const memReset = fallbackResetTokens.get(tokenHash);
    const fallbackUser = memReset
      ? runtimeStore.users.find((u) => u.id === memReset.userId)
      : undefined;

    if (!memReset || memReset.used || memReset.expiresAt <= Date.now() || !fallbackUser) {
      throw new AuthError(
        'INVALID_RESET_TOKEN',
        'El código de recuperación es inválido o ha expirado.',
        400
      );
    }
    fallbackUser.passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_SALT_ROUNDS);
    memReset.used = true;
  }
}
