import {
  AuthSessionResponse,
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput
} from '@bothub/shared';
import { useAuthStore } from '../store/auth.store.js';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export class ApiRequestError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function performRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { accessToken } = useAuthStore.getState();
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken && accessToken !== 'demo-session-mode-active') {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const errorCode = typeof data.error === 'string' ? data.error : 'API_ERROR';
    const errorMessage =
      typeof data.message === 'string'
        ? data.message
        : 'No se pudo completar la solicitud con el servidor.';
    throw new ApiRequestError(errorCode, errorMessage, response.status);
  }

  return data as T;
}

export const authApi = {
  login: (input: LoginInput) =>
    performRequest<AuthSessionResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  refresh: (refreshToken: string) =>
    performRequest<AuthSessionResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken })
    }),

  logout: (refreshToken: string) =>
    performRequest<{ success: boolean }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken })
    }),

  forgotPassword: (input: ForgotPasswordInput) =>
    performRequest<{
      success: boolean;
      message: string;
      devResetToken?: string;
    }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  resetPassword: (input: ResetPasswordInput) =>
    performRequest<{ success: boolean; message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(input)
    })
};
