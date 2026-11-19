import {
  ChatwootConfigDto,
  ChatwootLabelDto,
  FlowSimulationBotReply
} from '@bothub/shared';
import {
  isBlockedHostnameOrIp,
  isSimulatedLocalHostname,
  pinnedSafeFetch
} from '../../lib/ssrf-guard.js';

const HTTP_TIMEOUT_MS = 8000;

export function shouldCallRemoteChatwoot(
  baseUrl: string,
  conversationId?: number
): boolean {
  if (conversationId !== undefined && conversationId <= 0) {
    return false;
  }
  try {
    const parsed = new URL(baseUrl);
    if (isSimulatedLocalHostname(parsed.hostname)) {
      return false;
    }
    if (isBlockedHostnameOrIp(parsed.hostname)) {
      return false;
    }
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export interface ChatwootApiCallResult {
  sent: boolean;
  status?: number;
  errorDetail?: string;
}

export async function verifyChatwootConnectionApi(params: {
  config: ChatwootConfigDto;
  apiAccessToken: string;
}): Promise<{
  connected: boolean;
  latencyMs: number;
  inboxName: string;
  message: string;
}> {
  if (!shouldCallRemoteChatwoot(params.config.baseUrl)) {
    return {
      connected: true,
      latencyMs: 1,
      inboxName: `Chatwoot Inbox #${params.config.inboxId}`,
      message: `Configuración local validada para ${params.config.baseUrl} (Account #${params.config.accountId} · Inbox #${params.config.inboxId}).`
    };
  }

  const endpoint = `${params.config.baseUrl}/api/v1/accounts/${params.config.accountId}/inboxes/${params.config.inboxId}`;
  const startedAt = Date.now();

  const response = await pinnedSafeFetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      api_access_token: params.apiAccessToken
    },
    timeoutMs: HTTP_TIMEOUT_MS
  });
  const latencyMs = Math.max(1, Date.now() - startedAt);

  if (!response.ok) {
    const errorText = response.text;
    if (
      response.status === 401 &&
      errorText.toLowerCase().includes('not authorized for bots')
    ) {
      return {
        connected: true,
        latencyMs,
        inboxName: `Agent Bot · Inbox #${params.config.inboxId}`,
        message: `Conexión verificada con ${params.config.baseUrl} en ${latencyMs}ms (Token de Agent Bot autorizado para mensajes y handoff).`
      };
    }
    throw new Error(
      `Chatwoot respondió HTTP ${response.status}: ${errorText.slice(0, 180)}`
    );
  }

  let payload: { name?: string; id?: number } = {};
  try {
    payload = JSON.parse(response.text) as { name?: string; id?: number };
  } catch {
    payload = {};
  }
  const inboxName = payload.name || `Chatwoot Inbox #${params.config.inboxId}`;

  return {
    connected: true,
    latencyMs,
    inboxName,
    message: `Conexión verificada con ${params.config.baseUrl} (${inboxName}) en ${latencyMs}ms.`
  };
}

function buildChatwootMessageBody(params: {
  content: string;
  isPrivate?: boolean;
  messageType?: 'incoming' | 'outgoing';
  reply?: FlowSimulationBotReply;
  forcePlainText?: boolean;
}): Record<string, unknown> {
  const baseBody: Record<string, unknown> = {
    content: params.content,
    message_type: params.messageType ?? 'outgoing',
    private: Boolean(params.isPrivate)
  };

  if (params.forcePlainText || params.isPrivate || !params.reply) {
    return baseBody;
  }

  if (Array.isArray(params.reply.buttons) && params.reply.buttons.length > 0) {
    return {
      ...baseBody,
      content: params.reply.text.trim() || params.content,
      content_type: 'input_select',
      content_attributes: {
        items: params.reply.buttons.slice(0, 3).map((btn) => ({
          title: btn.label.trim().slice(0, 20),
          value: btn.label.trim()
        }))
      }
    };
  }

  if (Array.isArray(params.reply.listItems) && params.reply.listItems.length > 0) {
    return {
      ...baseBody,
      content: params.reply.text.trim() || params.content,
      content_type: 'input_select',
      content_attributes: {
        items: params.reply.listItems.slice(0, 10).map((item) => ({
          title: item.title.trim().slice(0, 24),
          value: item.title.trim(),
          ...(item.description
            ? { description: item.description.trim().slice(0, 72) }
            : {})
        }))
      }
    };
  }

  return baseBody;
}

export async function sendMessageToChatwootApi(params: {
  config: ChatwootConfigDto;
  apiAccessToken: string;
  conversationId: number;
  content: string;
  isPrivate?: boolean;
  messageType?: 'incoming' | 'outgoing';
  reply?: FlowSimulationBotReply;
}): Promise<ChatwootApiCallResult> {
  if (!shouldCallRemoteChatwoot(params.config.baseUrl, params.conversationId)) {
    return { sent: false, errorDetail: 'skipped_local_url' };
  }

  const trimmedContent = params.content.trim();
  if (!trimmedContent) {
    return { sent: false, errorDetail: 'empty_content' };
  }

  const endpoint = `${params.config.baseUrl}/api/v1/accounts/${params.config.accountId}/conversations/${params.conversationId}/messages`;

  try {
    const firstPayload = buildChatwootMessageBody({
      content: trimmedContent,
      isPrivate: params.isPrivate,
      messageType: params.messageType,
      reply: params.reply
    });

    let response = await pinnedSafeFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_access_token: params.apiAccessToken
      },
      body: JSON.stringify(firstPayload),
      timeoutMs: HTTP_TIMEOUT_MS
    });

    if (
      !response.ok &&
      (response.status === 400 || response.status === 422) &&
      firstPayload.content_type === 'input_select'
    ) {
      response = await pinnedSafeFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          api_access_token: params.apiAccessToken
        },
        body: JSON.stringify(
          buildChatwootMessageBody({
            content: trimmedContent,
            isPrivate: params.isPrivate,
            messageType: params.messageType,
            forcePlainText: true
          })
        ),
        timeoutMs: HTTP_TIMEOUT_MS
      });
    }

    if (!response.ok) {
      return {
        sent: false,
        status: response.status,
        errorDetail: `HTTP ${response.status}: ${response.text.slice(0, 220)}`
      };
    }

    return { sent: true, status: response.status };
  } catch (err) {
    return {
      sent: false,
      errorDetail: err instanceof Error ? err.message : 'Network error'
    };
  }
}

export async function fetchChatwootConversationStatusApi(params: {
  config: ChatwootConfigDto;
  apiAccessToken: string;
  conversationId: number;
}): Promise<{ ok: boolean; status?: string; errorDetail?: string }> {
  if (!shouldCallRemoteChatwoot(params.config.baseUrl, params.conversationId)) {
    return { ok: false, errorDetail: 'skipped_local_url' };
  }

  const endpoint = `${params.config.baseUrl}/api/v1/accounts/${params.config.accountId}/conversations/${params.conversationId}`;
  try {
    const response = await pinnedSafeFetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        api_access_token: params.apiAccessToken
      },
      timeoutMs: HTTP_TIMEOUT_MS
    });
    if (!response.ok) {
      return {
        ok: false,
        errorDetail: `HTTP ${response.status}: ${response.text.slice(0, 140)}`
      };
    }
    const data = JSON.parse(response.text || '{}') as {
      status?: string;
      payload?: { status?: string };
    };
    const convStatus = (data.status ?? data.payload?.status ?? '').toLowerCase();
    return { ok: true, status: convStatus };
  } catch (err) {
    return {
      ok: false,
      errorDetail: err instanceof Error ? err.message : 'Network error'
    };
  }
}

export async function toggleChatwootConversationStatusApi(params: {
  config: ChatwootConfigDto;
  apiAccessToken: string;
  conversationId: number;
  status: 'open' | 'pending' | 'resolved';
}): Promise<{ ok: boolean; statusCode?: number; errorDetail?: string }> {
  if (!shouldCallRemoteChatwoot(params.config.baseUrl, params.conversationId)) {
    return { ok: false, errorDetail: 'skipped_local_url' };
  }

  const endpoint = `${params.config.baseUrl}/api/v1/accounts/${params.config.accountId}/conversations/${params.conversationId}/toggle_status`;

  try {
    const response = await pinnedSafeFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_access_token: params.apiAccessToken
      },
      body: JSON.stringify({ status: params.status }),
      timeoutMs: HTTP_TIMEOUT_MS
    });
    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.status,
        errorDetail: `HTTP ${response.status}: ${response.text.slice(0, 140)}`
      };
    }
    return { ok: true, statusCode: response.status };
  } catch (err) {
    return {
      ok: false,
      errorDetail: err instanceof Error ? err.message : 'Network error'
    };
  }
}

export function formatBotReplyForChatwoot(reply: FlowSimulationBotReply): string {
  let formatted = reply.text.trim();

  if (Array.isArray(reply.buttons) && reply.buttons.length > 0) {
    const optionLines = reply.buttons.map((btn, idx) => {
      const prefix = `${idx + 1}.`;
      return btn.label.trim().startsWith(prefix)
        ? `• ${btn.label.trim()}`
        : `${prefix} ${btn.label.trim()}`;
    });
    formatted = `${formatted}\n\n${optionLines.join('\n')}`;
  }

  if (Array.isArray(reply.listItems) && reply.listItems.length > 0) {
    const listLines = reply.listItems.map((item, idx) => {
      const desc = item.description ? ` — ${item.description}` : '';
      return `${idx + 1}. ${item.title}${desc}`;
    });
    formatted = `${formatted}\n\n${listLines.join('\n')}`;
  }

  if (reply.mediaUrl && !formatted.includes(reply.mediaUrl)) {
    formatted = formatted ? `${formatted}\n\n${reply.mediaUrl}` : reply.mediaUrl;
  }

  return formatted;
}

export async function fetchChatwootAccountLabelsApi(params: {
  config: ChatwootConfigDto;
  apiAccessToken: string;
}): Promise<ChatwootLabelDto[]> {
  if (!shouldCallRemoteChatwoot(params.config.baseUrl)) {
    return [];
  }

  const endpoint = `${params.config.baseUrl}/api/v1/accounts/${params.config.accountId}/labels`;
  const response = await pinnedSafeFetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      api_access_token: params.apiAccessToken
    },
    timeoutMs: HTTP_TIMEOUT_MS
  });

  if (!response.ok) {
    if (
      response.status === 401 &&
      response.text.toLowerCase().includes('not authorized for bots')
    ) {
      throw new Error(
        'El token actual es de Agent Bot y Chatwoot restringe listar etiquetas a tokens de Usuario/Administrador. Agrega tu Token de Perfil de Chatwoot en el campo "Token de Usuario/Admin (para Etiquetas)" del bot.'
      );
    }
    throw new Error(
      `Chatwoot respondió HTTP ${response.status} al consultar etiquetas: ${response.text.slice(0, 180)}`
    );
  }

  const parsed = JSON.parse(response.text || '{}') as {
    payload?: Array<{
      id?: number;
      title?: string;
      description?: string | null;
      color?: string;
    }>;
  };

  const rawLabels = Array.isArray(parsed.payload) ? parsed.payload : [];
  return rawLabels
    .filter((item) => typeof item.title === 'string' && item.title.trim().length > 0)
    .map((item, idx) => ({
      id: typeof item.id === 'number' ? item.id : idx + 1,
      title: String(item.title).trim(),
      description: typeof item.description === 'string' ? item.description : null,
      color: typeof item.color === 'string' && item.color ? item.color : '#2152FF'
    }));
}

export async function applyChatwootConversationLabelsApi(params: {
  config: ChatwootConfigDto;
  apiAccessToken: string;
  conversationId: number;
  labels: string[];
}): Promise<{
  applied: boolean;
  labels: string[];
  status?: number;
  errorDetail?: string;
}> {
  const newLabels = Array.from(
    new Set(params.labels.map((item) => item.trim()).filter(Boolean))
  );
  if (newLabels.length === 0) {
    return { applied: false, labels: [], errorDetail: 'empty_labels' };
  }

  if (!shouldCallRemoteChatwoot(params.config.baseUrl, params.conversationId)) {
    return { applied: false, labels: newLabels, errorDetail: 'skipped_local_url' };
  }

  const endpoint = `${params.config.baseUrl}/api/v1/accounts/${params.config.accountId}/conversations/${params.conversationId}/labels`;
  let existingLabels: string[] = [];

  try {
    const existingRes = await pinnedSafeFetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        api_access_token: params.apiAccessToken
      },
      timeoutMs: HTTP_TIMEOUT_MS
    });
    if (existingRes.ok) {
      const parsedExisting = JSON.parse(existingRes.text || '{}') as {
        payload?: unknown;
      };
      if (Array.isArray(parsedExisting.payload)) {
        existingLabels = parsedExisting.payload
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean);
      }
    }
  } catch {
    void 0;
  }

  const mergedLabels = Array.from(new Set([...existingLabels, ...newLabels]));

  try {
    const postRes = await pinnedSafeFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_access_token: params.apiAccessToken
      },
      body: JSON.stringify({ labels: mergedLabels }),
      timeoutMs: HTTP_TIMEOUT_MS
    });

    if (!postRes.ok) {
      return {
        applied: false,
        labels: mergedLabels,
        status: postRes.status,
        errorDetail: `HTTP ${postRes.status}: ${postRes.text.slice(0, 220)}`
      };
    }

    return { applied: true, labels: mergedLabels, status: postRes.status };
  } catch (err) {
    return {
      applied: false,
      labels: mergedLabels,
      errorDetail: err instanceof Error ? err.message : 'Network error'
    };
  }
}
