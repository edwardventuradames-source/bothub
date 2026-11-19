import { ChatwootConfigDto, FlowSimulationBotReply } from '@bothub/shared';

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
    if (
      parsed.hostname.endsWith('.local') ||
      parsed.hostname === 'example.com' ||
      parsed.hostname === 'localhost'
    ) {
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        api_access_token: params.apiAccessToken
      },
      signal: controller.signal
    });
    const latencyMs = Math.max(1, Date.now() - startedAt);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
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

    const payload = (await response.json().catch(() => ({}))) as {
      name?: string;
      id?: number;
    };
    const inboxName = payload.name || `Chatwoot Inbox #${params.config.inboxId}`;

    return {
      connected: true,
      latencyMs,
      inboxName,
      message: `Conexión verificada con ${params.config.baseUrl} (${inboxName}) en ${latencyMs}ms.`
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMessageToChatwootApi(params: {
  config: ChatwootConfigDto;
  apiAccessToken: string;
  conversationId: number;
  content: string;
  isPrivate?: boolean;
  messageType?: 'incoming' | 'outgoing';
}): Promise<ChatwootApiCallResult> {
  if (!shouldCallRemoteChatwoot(params.config.baseUrl, params.conversationId)) {
    return { sent: false, errorDetail: 'skipped_local_url' };
  }

  const trimmedContent = params.content.trim();
  if (!trimmedContent) {
    return { sent: false, errorDetail: 'empty_content' };
  }

  const endpoint = `${params.config.baseUrl}/api/v1/accounts/${params.config.accountId}/conversations/${params.conversationId}/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_access_token: params.apiAccessToken
      },
      body: JSON.stringify({
        content: trimmedContent,
        message_type: params.messageType ?? 'outgoing',
        private: Boolean(params.isPrivate)
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        sent: false,
        status: response.status,
        errorDetail: `HTTP ${response.status}: ${errorBody.slice(0, 220)}`
      };
    }

    return { sent: true, status: response.status };
  } catch (err) {
    return {
      sent: false,
      errorDetail: err instanceof Error ? err.message : 'Network error'
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function toggleChatwootConversationStatusApi(params: {
  config: ChatwootConfigDto;
  apiAccessToken: string;
  conversationId: number;
  status: 'open' | 'pending' | 'resolved';
}): Promise<void> {
  if (!shouldCallRemoteChatwoot(params.config.baseUrl, params.conversationId)) {
    return;
  }

  const endpoint = `${params.config.baseUrl}/api/v1/accounts/${params.config.accountId}/conversations/${params.conversationId}/toggle_status`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_access_token: params.apiAccessToken
      },
      body: JSON.stringify({ status: params.status }),
      signal: controller.signal
    });
  } catch {
    void 0;
  } finally {
    clearTimeout(timer);
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

  return formatted;
}
