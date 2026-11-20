import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  GitBranch,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Tag,
  UserCheck
} from 'lucide-react';
import { ConversationDto } from '@bothub/shared';
import { platformApi } from '../lib/api.js';
import { createAuthenticatedSocket } from '../lib/socket.js';
import { useAuthStore } from '../store/auth.store.js';
import {
  HttpExecutionDetailsCard,
  getHttpStatusBadgeInfo
} from '../components/flows/HttpExecutionDetailsCard.js';

export function ConversationsPage() {
  const outletContext = useOutletContext<{ searchQuery?: string } | null>();
  const searchQuery = outletContext?.searchQuery ?? '';
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const canOperate = user?.role === 'ADMIN' || user?.role === 'OPERATOR';

  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [banner, setBanner] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const loadConversations = useCallback(async (filterStatus: string): Promise<void> => {
    setIsLoading(true);
    try {
      const res = await platformApi.listConversations({ status: filterStatus });
      setConversations(res.conversations);
      setSelectedId((prev) => {
        if (prev && res.conversations.some((c) => c.id === prev)) {
          return prev;
        }
        return res.conversations[0]?.id ?? null;
      });
    } catch (err) {
      setBanner({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'No se pudieron cargar las conversaciones.'
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations(statusFilter);
  }, [statusFilter, loadConversations]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    const socket = createAuthenticatedSocket();
    if (!socket) {
      return;
    }

    socket.on('conversation:updated', (updated: ConversationDto) => {
      setConversations((prev) => {
        const matchesFilter =
          statusFilter === 'ALL' || updated.status === statusFilter;
        const exists = prev.some((c) => c.id === updated.id);
        if (!matchesFilter) {
          return prev.filter((c) => c.id !== updated.id);
        }
        if (exists) {
          return [
            updated,
            ...prev.filter((c) => c.id !== updated.id)
          ];
        }
        return [updated, ...prev];
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [accessToken, statusFilter]);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter(
      (conv) =>
        conv.contactName.toLowerCase().includes(query) ||
        conv.contactPhone.toLowerCase().includes(query) ||
        conv.botName.toLowerCase().includes(query) ||
        conv.lastMessagePreview.toLowerCase().includes(query)
    );
  }, [conversations, searchQuery]);

  const selectedConversation =
    filteredConversations.find((c) => c.id === selectedId) ??
    filteredConversations[0] ??
    null;

  async function handleHandoffToggle(
    convId: string,
    action: 'RETURN_TO_BOT' | 'TRANSFER_TO_AGENT' | 'RESOLVE'
  ): Promise<void> {
    if (!canOperate || isUpdating) return;
    setIsUpdating(true);
    try {
      const { conversation } = await platformApi.handoffAction(
        convId,
        action,
        action === 'RESOLVE'
          ? 'Resuelta desde el monitor de conversaciones BotHub.'
          : 'Transferencia solicitada desde el monitor de conversaciones BotHub.'
      );
      setConversations((prev) =>
        prev.map((item) => (item.id === conversation.id ? conversation : item))
      );
      setBanner({
        type: 'ok',
        text:
          action === 'RETURN_TO_BOT'
            ? 'Conversación devuelta al control automático del bot (#bot).'
            : action === 'RESOLVE'
              ? 'Conversación marcada como resuelta y sincronizada con Chatwoot.'
              : 'Conversación transferida a cola de agentes en Chatwoot.'
      });
    } catch (err) {
      setBanner({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo actualizar el estado de handoff.'
      });
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleSyncChatwoot(): Promise<void> {
    if (!canOperate || isUpdating) return;
    setIsUpdating(true);
    try {
      const res = await platformApi.syncConversationsChatwoot();
      await loadConversations(statusFilter);
      setBanner({
        type: 'ok',
        text: `Sincronización completada: ${res.checkedCount} revisadas, ${res.updatedCount} actualizadas desde Chatwoot.`
      });
    } catch (err) {
      setBanner({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo sincronizar el estado con Chatwoot.'
      });
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="soft-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-soft-blue/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
            <MessageSquare className="h-3.5 w-3.5" />
            <span>Chatwoot Sync & Trazabilidad de Flujos</span>
          </span>
          <h1 className="mt-1.5 text-xl font-extrabold text-soft-ink">
            Monitor de Conversaciones y Handoff ({filteredConversations.length})
          </h1>
          <p className="mt-0.5 text-xs text-soft-muted">
            Inspecciona el historial sincronizado con Chatwoot, los nodos ejecutados por mensaje y el estado de transferencia humano/bot.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canOperate ? (
            <button
              type="button"
              disabled={isUpdating}
              onClick={() => void handleSyncChatwoot()}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs font-extrabold text-soft-blue hover:border-soft-blue disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
              <span>Sincronizar Chatwoot</span>
            </button>
          ) : null}
          {[
            { id: 'ALL', label: 'Todas' },
            { id: 'BOT_ACTIVE', label: '🤖 Bot Activo' },
            { id: 'PENDING_AGENT', label: '⏳ Esperando Agente' },
            { id: 'AGENT_ACTIVE', label: '👨‍💼 Con Agente' },
            { id: 'RESOLVED', label: '✅ Resueltas' }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`min-h-[38px] rounded-xl px-3.5 py-2 text-xs font-extrabold transition-all ${
                statusFilter === tab.id
                  ? 'bg-brand-gradient text-white shadow-brand-icon'
                  : 'bg-soft-bg text-soft-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {banner ? (
        <div
          role={banner.type === 'err' ? 'alert' : 'status'}
          className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 text-xs font-bold ${
            banner.type === 'ok'
              ? 'border-[#82d616]/40 bg-[#82d616]/15 text-soft-ink'
              : 'border-soft-danger/40 bg-soft-danger/15 text-soft-danger'
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="underline"
          >
            Cerrar
          </button>
        </div>
      ) : null}

      {!isLoading && filteredConversations.length === 0 ? (
        <div className="soft-card flex flex-col items-center justify-center gap-2 p-10 text-center">
          <MessageSquare className="h-8 w-8 text-soft-blue" />
          <h2 className="text-base font-extrabold text-soft-ink">
            {conversations.length === 0
              ? 'Aún no hay conversaciones en esta vista'
              : 'Sin coincidencias para tu búsqueda'}
          </h2>
          <p className="max-w-md text-xs text-soft-muted">
            Cuando tus bots reciban mensajes entrantes por WhatsApp o Chatwoot aparecerán aquí en tiempo real con su trazabilidad completa.
          </p>
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr] 2xl:grid-cols-[340px_1fr_340px]">
          <div className="soft-card flex h-[480px] flex-col gap-2.5 overflow-y-auto p-4 lg:h-[560px]">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-soft-muted">
              Sesiones Recientes
            </h2>
            {filteredConversations.map((conv) => {
              const isSelected = selectedConversation?.id === conv.id;
              const isBot = conv.status === 'BOT_ACTIVE';
              const isResolved = conv.status === 'RESOLVED';
              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => setSelectedId(conv.id)}
                  className={`flex flex-col gap-1.5 rounded-2xl border p-3.5 text-left transition-all ${
                    isSelected
                      ? 'border-soft-blue bg-soft-blue/5'
                      : 'border-soft-line bg-soft-bg hover:border-soft-blue/50'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <strong className="truncate text-xs font-extrabold text-soft-ink">
                      {conv.contactName}
                    </strong>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                        isBot
                          ? 'bg-[#82d616]/15 text-[#4b830d] dark:text-[#82d616]'
                          : isResolved
                            ? 'bg-soft-blue/15 text-soft-blue'
                            : 'bg-soft-warning/15 text-soft-warning'
                      }`}
                    >
                      {conv.status === 'BOT_ACTIVE'
                        ? 'Bot Activo'
                        : conv.status === 'PENDING_AGENT'
                          ? 'En Chatwoot (Pendiente)'
                          : conv.status === 'AGENT_ACTIVE'
                            ? 'Con Agente'
                            : 'Resuelta'}
                    </span>
                  </div>
                  <span className="truncate text-[11px] font-semibold text-soft-muted">
                    {conv.contactPhone} · Chatwoot #{conv.chatwootConversationId ?? 'N/A'}
                  </span>
                  <p className="line-clamp-2 text-xs text-soft-ink">
                    {conv.lastMessagePreview}
                  </p>
                </button>
              );
            })}
          </div>

          {selectedConversation ? (
            <div className="soft-card flex h-[540px] flex-col justify-between p-5 lg:h-[560px]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-soft-line pb-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-extrabold text-soft-ink">
                    {selectedConversation.contactName} (
                    {selectedConversation.contactPhone})
                  </h2>
                  <p className="truncate text-xs text-soft-muted">
                    Bot: <strong>{selectedConversation.botName}</strong> · Flujo:{' '}
                    <strong>{selectedConversation.currentFlowName ?? 'Principal'}</strong>
                  </p>
                </div>

                {canOperate ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedConversation.status === 'BOT_ACTIVE' ? (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() =>
                          void handleHandoffToggle(
                            selectedConversation.id,
                            'TRANSFER_TO_AGENT'
                          )
                        }
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-brand-gradient px-3.5 py-2 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        <span>Transferir a Chatwoot</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() =>
                          void handleHandoffToggle(
                            selectedConversation.id,
                            'RETURN_TO_BOT'
                          )
                        }
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-soft-blue bg-soft-blue/10 px-3.5 py-2 text-xs font-extrabold text-soft-blue disabled:opacity-60"
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                        <span>Devolver Control al Bot (#bot)</span>
                      </button>
                    )}

                    {selectedConversation.status !== 'RESOLVED' ? (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() =>
                          void handleHandoffToggle(selectedConversation.id, 'RESOLVE')
                        }
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs font-extrabold text-soft-ink hover:border-soft-blue disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#4b830d] dark:text-[#82d616]" />
                        <span>Marcar Resuelta</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="my-3 flex flex-1 flex-col gap-3 overflow-y-auto rounded-2xl bg-soft-bg p-4">
                {selectedConversation.messages.map((msg) => {
                  const isContact = msg.senderType === 'CONTACT';
                  const isSystem = msg.senderType === 'SYSTEM';

                  if (isSystem) {
                    return (
                      <div
                        key={msg.id}
                        className="mx-auto max-w-md rounded-xl border border-soft-warning/40 bg-soft-warning/10 px-3 py-2 text-center text-[11px] font-bold text-soft-ink"
                      >
                        {msg.content}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${
                        isContact ? 'items-start' : 'items-end'
                      }`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs ${
                          isContact
                            ? 'border border-soft-line bg-soft-card text-soft-ink'
                            : 'bg-brand-gradient text-white shadow-brand-icon'
                        }`}
                      >
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[10px] opacity-80">
                          <strong>{msg.senderName}</strong>
                          {msg.executedNodeLabel ? (
                            <span className="rounded bg-black/15 px-1.5 py-0.5 font-mono">
                              ⚡ {msg.executedNodeLabel}
                            </span>
                          ) : null}
                        </div>
                        <p className="whitespace-pre-wrap leading-relaxed">
                          {msg.content}
                        </p>
                        {msg.mediaUrl ? (
                          <a
                            href={msg.mediaUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1.5 block truncate text-[11px] underline opacity-90"
                          >
                            📎 {msg.mediaUrl}
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-soft-bg px-3.5 py-2 text-xs text-soft-muted">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <Bot className="h-4 w-4 shrink-0 text-soft-blue" />
                  <span>
                    {selectedConversation.chatwootConversationId !== null
                      ? `Sincronizado con Chatwoot Inbox (Conversación #${selectedConversation.chatwootConversationId})`
                      : 'Sesión WhatsApp sin vínculo Chatwoot activo'}
                  </span>
                </span>
                <span className="font-bold text-soft-ink">
                  {selectedConversation.assignedAgentName ?? 'Automatizado por BotHub'}
                </span>
              </div>
            </div>
          ) : null}

          {selectedConversation ? (
            <div className="soft-card flex h-[480px] flex-col justify-between overflow-y-auto p-4 lg:col-span-2 lg:h-auto 2xl:col-span-1 2xl:h-[560px]">
              <div className="flex flex-col gap-4">
                <div>
                  <span className="inline-flex items-center gap-1 text-xs font-extrabold uppercase tracking-wider text-soft-blue">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Variables Capturadas</span>
                  </span>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {Object.keys(selectedConversation.collectedVariables).length === 0 ? (
                      <p className="text-xs text-soft-muted">Sin variables capturadas aún.</p>
                    ) : (
                      Object.entries(selectedConversation.collectedVariables).map(
                        ([k, v]) => (
                          <div
                            key={k}
                            className="flex items-center justify-between gap-2 rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs"
                          >
                            <code className="font-bold text-soft-blue">{`{{${k}}}`}</code>
                            <span className="truncate font-semibold text-soft-ink">{v}</span>
                          </div>
                        )
                      )
                    )}
                  </div>
                </div>

                <div>
                  <span className="inline-flex items-center gap-1 text-xs font-extrabold uppercase tracking-wider text-soft-blue">
                    <Tag className="h-3.5 w-3.5" />
                    <span>Etiquetas Sincronizadas</span>
                  </span>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedConversation.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-[#82d616]/15 px-2.5 py-1 text-[11px] font-extrabold text-[#4b830d] dark:text-[#82d616]"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="inline-flex items-center gap-1 text-xs font-extrabold uppercase tracking-wider text-soft-blue">
                    <GitBranch className="h-3.5 w-3.5" />
                    <span>Trazabilidad de Nodos Ejecutados</span>
                  </span>
                  <div className="mt-2 flex flex-col gap-2">
                    {selectedConversation.executionTrace.length === 0 ? (
                      <p className="text-xs text-soft-muted">
                        Sin trazas de ejecución registradas.
                      </p>
                    ) : (
                      selectedConversation.executionTrace.map((step, idx) => (
                        <div
                          key={`${step.nodeId}-${idx}`}
                          className="rounded-xl border border-soft-line bg-soft-bg p-2.5 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <strong className="truncate text-soft-ink">{step.title}</strong>
                            <div className="flex shrink-0 items-center gap-1">
                              {step.httpDetails ? (
                                <span
                                  className={`rounded border px-1.5 py-0.5 text-[10px] font-extrabold ${
                                    getHttpStatusBadgeInfo(
                                      step.httpDetails.statusCode,
                                      step.httpDetails.ok
                                    ).badgeClass
                                  }`}
                                >
                                  {step.httpDetails.statusCode ?? 'ERR'}
                                </span>
                              ) : null}
                              <span className="rounded bg-soft-blue/10 px-1.5 py-0.5 text-[10px] font-extrabold text-soft-blue">
                                {step.nodeType}
                              </span>
                            </div>
                          </div>
                          <p className="mt-1 text-[11px] text-soft-muted">
                            {step.detail}
                          </p>
                          {step.httpDetails ? (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-[11px] font-extrabold text-soft-blue">
                                Ver detalle HTTP (estado, envío y respuesta)
                              </summary>
                              <div className="mt-2">
                                <HttpExecutionDetailsCard details={step.httpDetails} />
                              </div>
                            </details>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
