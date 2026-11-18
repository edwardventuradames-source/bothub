import { z } from 'zod';

export const UserRoleSchema = z.enum(['ADMIN', 'OPERATOR', 'VIEWER']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const LoginInputSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(8).max(128)
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const RefreshTokenInputSchema = z.object({
  refreshToken: z.string().min(16)
});
export type RefreshTokenInput = z.infer<typeof RefreshTokenInputSchema>;

export const ForgotPasswordInputSchema = z.object({
  email: z.string().email().trim().toLowerCase()
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInputSchema>;

export const ResetPasswordInputSchema = z.object({
  token: z.string().min(16),
  newPassword: z.string().min(8).max(128)
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordInputSchema>;

export const AuthUserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: UserRoleSchema,
  organizationId: z.string().uuid(),
  organizationName: z.string(),
  avatarUrl: z.string().nullable().optional()
});
export type AuthUserDto = z.infer<typeof AuthUserDtoSchema>;

export const AuthSessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: AuthUserDtoSchema
});
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
