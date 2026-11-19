import { Server as SocketIOServer } from 'socket.io';
import { BotDto, ChatwootConfigDto } from '@bothub/shared';
import { runtimeStore } from '../../lib/runtime-store.js';
import { applyChatwootConversationLabelsApi } from './chatwoot.client.js';

export async function syncAssignedFlowLabelsToChatwoot(params: {
  bot: BotDto;
  config: ChatwootConfigDto;
  apiAccessToken: string;
  userApiAccessToken?: string | null;
  chatwootConvId: number;
  assignedTags?: string[];
  io?: SocketIOServer;
}): Promise<void> {
  const tagsToApply = Array.isArray(params.assignedTags)
    ? params.assignedTags.map((t) => t.trim()).filter(Boolean)
    : [];
  if (tagsToApply.length === 0) {
    return;
  }

  const labelToken = params.userApiAccessToken || params.apiAccessToken;
  const result = await applyChatwootConversationLabelsApi({
    config: params.config,
    apiAccessToken: labelToken,
    conversationId: params.chatwootConvId,
    labels: tagsToApply
  });

  if (result.applied) {
    const okLog = runtimeStore.appendLog({
      organizationId: params.bot.organizationId,
      botId: params.bot.id,
      botName: params.bot.name,
      level: 'INFO',
      event: 'chatwoot.labels.applied',
      message: `Etiquetas aplicadas en Chatwoot (Conv #${params.chatwootConvId}): ${result.labels.join(', ')}`,
      metadata: {
        chatwootConversationId: params.chatwootConvId,
        labels: result.labels
      }
    });
    if (params.io) {
      params.io.to(`org:${params.bot.organizationId}`).emit('log:new', okLog);
    }
    return;
  }

  if (result.errorDetail && result.errorDetail !== 'skipped_local_url') {
    const isBotTokenRestriction =
      result.status === 401 &&
      result.errorDetail.toLowerCase().includes('not authorized for bots');
    const warnLog = runtimeStore.appendLog({
      organizationId: params.bot.organizationId,
      botId: params.bot.id,
      botName: params.bot.name,
      level: 'WARN',
      event: 'chatwoot.labels.error',
      message: isBotTokenRestriction
        ? `No se pudieron aplicar etiquetas (${tagsToApply.join(', ')}) en Chatwoot Conv #${params.chatwootConvId} porque el Token de Agent Bot no tiene permiso sobre /labels. Configura el "Token de Usuario/Admin (para Etiquetas)" en la pestaña Chatwoot del bot.`
        : `Error aplicando etiquetas (${tagsToApply.join(', ')}) en Chatwoot Conv #${params.chatwootConvId}: ${result.errorDetail}`,
      metadata: {
        chatwootConversationId: params.chatwootConvId,
        status: result.status ?? null,
        labels: tagsToApply
      }
    });
    if (params.io) {
      params.io.to(`org:${params.bot.organizationId}`).emit('log:new', warnLog);
    }
  }
}
