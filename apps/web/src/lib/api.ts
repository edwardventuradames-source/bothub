import {
  ApiKeyDto,
  AuthSessionResponse,
  BotDto,
  BotLogDto,
  ChatwootConfigDto,
  ChatwootConfigInput,
  CloudApiConfigInput,
  ContactDto,
  ConversationDto,
  CreateBotInput,
  CreateFlowInput,
  CreateUserInput,
  DashboardMetricsDto,
  FlowDto,
  FlowSimulationRequest,
  FlowSimulationResponse,
  ForgotPasswordInput,
  LoginInput,
  OrganizationUserDto,
  OutboundWebhookConfigDto,
  OutboundWebhookConfigInput,
  RegisterInput,
  ResetPasswordInput,
  SaveFlowGraphInput,
  UpdateBotInput,
  UpdateUserInput
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

let activeRefreshPromise: Promise<string | null> | null = null;

async function tryRefreshAccessToken(): Promise<string | null> {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  const { refreshToken, setSession, clearSession } = useAuthStore.getState();
  if (!refreshToken) {
    clearSession();
    return null;
  }

  activeRefreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          clearSession();
        }
        return null;
      }

      const data = (await response.json()) as AuthSessionResponse;
      if (data.accessToken && data.refreshToken && data.user) {
        setSession({
          user: data.user,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken
        });
        return data.accessToken;
      }
      return null;
    } catch {
      return null;
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
}

async function performRequest<T>(
  path: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  const { accessToken } = useAuthStore.getState();
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });

  if (response.status === 401 && !path.startsWith('/auth/') && !isRetry) {
    const newAccessToken = await tryRefreshAccessToken();
    if (newAccessToken) {
      return performRequest<T>(path, options, true);
    }
  }

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
  register: (input: RegisterInput) =>
    performRequest<AuthSessionResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input)
    }),

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

export const botsApi = {
  list: () => performRequest<{ bots: BotDto[] }>('/bots'),
  getById: (id: string) => performRequest<{ bot: BotDto }>(`/bots/${id}`),
  create: (input: CreateBotInput) =>
    performRequest<{ bot: BotDto }>('/bots', {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  update: (id: string, input: UpdateBotInput) =>
    performRequest<{ bot: BotDto }>(`/bots/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input)
    }),
  duplicate: (id: string) =>
    performRequest<{ bot: BotDto }>(`/bots/${id}/duplicate`, {
      method: 'POST'
    }),
  togglePause: (id: string) =>
    performRequest<{ bot: BotDto }>(`/bots/${id}/toggle-pause`, {
      method: 'POST'
    }),
  generateQr: (id: string) =>
    performRequest<{ bot: BotDto }>(`/bots/${id}/qr/generate`, {
      method: 'POST'
    }),
  disconnect: (id: string) =>
    performRequest<{ bot: BotDto }>(`/bots/${id}/disconnect`, {
      method: 'POST'
    }),
  saveChatwoot: (id: string, input: ChatwootConfigInput) =>
    performRequest<{ chatwootConfig: ChatwootConfigDto; bot: BotDto }>(
      `/bots/${id}/chatwoot`,
      {
        method: 'PUT',
        body: JSON.stringify(input)
      }
    ),
  testChatwoot: (id: string) =>
    performRequest<{
      connected: boolean;
      latencyMs: number;
      inboxName: string;
      message: string;
      bot?: BotDto;
    }>(`/bots/${id}/chatwoot/test`, {
      method: 'POST'
    }),
  saveCloudApi: (id: string, input: CloudApiConfigInput) =>
    performRequest<{ bot: BotDto }>(`/bots/${id}/cloud-api`, {
      method: 'PUT',
      body: JSON.stringify(input)
    }),
  remove: (id: string) =>
    performRequest<{ success: boolean }>(`/bots/${id}`, {
      method: 'DELETE'
    })
};

export const flowsApi = {
  list: () => performRequest<{ flows: FlowDto[] }>('/flows'),
  getById: (id: string) => performRequest<{ flow: FlowDto }>(`/flows/${id}`),
  create: (input: CreateFlowInput) =>
    performRequest<{ flow: FlowDto }>('/flows', {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  saveGraph: (id: string, input: SaveFlowGraphInput) =>
    performRequest<{ flow: FlowDto }>(`/flows/${id}/graph`, {
      method: 'PUT',
      body: JSON.stringify(input)
    }),
  simulateStep: (id: string, input: FlowSimulationRequest) =>
    performRequest<FlowSimulationResponse>(`/flows/${id}/simulate`, {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  restoreVersion: (id: string, versionId: string) =>
    performRequest<{ flow: FlowDto }>(`/flows/${id}/versions/${versionId}/restore`, {
      method: 'POST'
    }),
  remove: (id: string) =>
    performRequest<{ success: boolean }>(`/flows/${id}`, {
      method: 'DELETE'
    })
};

export const platformApi = {
  getDashboard: () =>
    performRequest<{
      metrics: DashboardMetricsDto;
      bots: BotDto[];
      recentLogs: BotLogDto[];
    }>('/dashboard/metrics'),
  listConversations: (params?: { status?: string; botId?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.botId) query.set('botId', params.botId);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return performRequest<{ conversations: ConversationDto[] }>(`/conversations${qs}`);
  },
  handoffAction: (
    id: string,
    action: 'RETURN_TO_BOT' | 'TRANSFER_TO_AGENT',
    reason?: string
  ) =>
    performRequest<{ conversation: ConversationDto }>(`/conversations/${id}/handoff`, {
      method: 'POST',
      body: JSON.stringify({ action, reason })
    }),
  listContacts: () => performRequest<{ contacts: ContactDto[] }>('/contacts'),
  updateContact: (
    id: string,
    payload: { tags?: string[]; variables?: Record<string, string> }
  ) =>
    performRequest<{ contact: ContactDto }>(`/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  listLogs: (params?: { level?: string; botId?: string }) => {
    const query = new URLSearchParams();
    if (params?.level) query.set('level', params.level);
    if (params?.botId) query.set('botId', params.botId);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return performRequest<{ logs: BotLogDto[] }>(`/logs${qs}`);
  },
  listUsers: () => performRequest<{ users: OrganizationUserDto[] }>('/users'),
  createUser: (input: CreateUserInput) =>
    performRequest<{ user: OrganizationUserDto }>('/users', {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  updateUser: (id: string, input: UpdateUserInput) =>
    performRequest<{ user: OrganizationUserDto }>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input)
    }),
  getSettingsOverview: () =>
    performRequest<{
      apiKeys: ApiKeyDto[];
      outboundWebhooks: OutboundWebhookConfigDto[];
    }>('/settings/overview'),
  createApiKey: (name: string, scopes: string[]) =>
    performRequest<{ apiKey: ApiKeyDto }>('/settings/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name, scopes })
    }),
  deleteApiKey: (id: string) =>
    performRequest<{ success: boolean }>(`/settings/api-keys/${id}`, {
      method: 'DELETE'
    }),
  createWebhook: (input: OutboundWebhookConfigInput) =>
    performRequest<{ webhook: OutboundWebhookConfigDto }>('/settings/webhooks', {
      method: 'POST',
      body: JSON.stringify(input)
    })
};
