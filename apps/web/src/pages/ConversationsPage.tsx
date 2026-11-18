import { useEffect, useState } from 'react';
import {
  ArrowRightLeft,
  Bot,
  GitBranch,
  MessageSquare,
  Sparkles,
  Tag,
  UserCheck
} from 'lucide-react';
import { ConversationDto } from '@bothub/shared';
import { platformApi } from '../lib/api.js';

export function ConversationsPage() {
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [banner, setBanner] = useState<string | null>(null);

  const selectedConversation =
    conversations.find((c) => c.id === selectedId) ?? conversations[0] ?? null;

  async function loadConversations(filterStatus = statusFilter): Promise<void> {
    const res = await platformApi.listConversations({ status: filterStatus });
    setConversations(res.conversations);
    if (!selectedId && res.conversations[0]) {
      setSelectedId(res.conversations[0].id);
    }
  }

  useEffect(() => {
    void loadConversations(statusFilter);
  }, [statusFilter]);

  async function handleHandoffToggle(
    convId: string,
    action: 'RETURN_TO_BOT' | 'TRANSFER_TO_AGENT'
  ): Promise<void> {
    const { conversation } = await platformApi.handoffAction(
      convId,
      action,
      'Transferencia solicitada desde el monitor de conversaciones BotHub.'
    );
    setConversations((prev) =>
      prev.map((item) => (item.id === conversation.id ? conversation : item))
    );
    setBanner(
      action === 'RETURN_TO_BOT'
        ? `🤖 Conversación devuelta al control automático del bot (#bot).`
        : `👨‍💼 Conversación transferida a cola de agentes en Chatwoot.`
    );
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
            Monitor de Conversaciones y Handoff ({conversations.length})
          </h1>
          <p className="mt-0.5 text-xs text-soft-muted">
            Inspecciona el historial sincronizado con Chatwoot, los nodos ejecutados por mensaje y el estado de transferencia humano/bot.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { id: 'ALL', label: 'Todas' },
            { id: 'BOT_ACTIVE', label: '🤖 Bot Activo' },
            { id: 'PENDING_AGENT', label: '⏳ Esperando Agente' },
            { id: 'AGENT_ACTIVE', label: '👨‍💼 Con Agente' }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`rounded-xl px-3.5 py-2 text-xs font-extrabold transition-all ${
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
          role="status"
          className="flex items-center justify-between rounded-2xl border border-[#82d616]/40 bg-[#82d616]/15 px-4 py-2.5 text-xs font-bold text-soft-ink"
        >
          <span>{banner}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="underline"
          >
            Cerrar
          </button>
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr_340px]">
        <div className="soft-card flex h-[560px] flex-col gap-2.5 overflow-y-auto p-4">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-soft-muted">
            Sesiones Recientes
          </h2>
          {conversations.map((conv) => {
            const isSelected = selectedConversation?.id === conv.id;
            const isBot = conv.status === 'BOT_ACTIVE';
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
                <div className="flex items-center justify-between">
                  <strong className="text-xs font-extrabold text-soft-ink">
                    {conv.contactName}
                  </strong>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                      isBot
                        ? 'bg-[#82d616]/15 text-[#4b830d]'
                        : 'bg-soft-warn/15 text-soft-warn'
                    }`}
                  >
                    {conv.status}
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-soft-muted">
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
          <div className="soft-card flex h-[560px] flex-col justify-between p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-soft-line pb-3">
              <div>
                <h2 className="text-sm font-extrabold text-soft-ink">
                  {selectedConversation.contactName} (
                  {selectedConversation.contactPhone})
                </h2>
                <p className="text-xs text-soft-muted">
                  Bot: <strong>{selectedConversation.botName}</strong> · Flujo:{' '}
                  <strong>{selectedConversation.currentFlowName ?? 'Principal'}</strong>
                </p>
              </div>

              <div className="flex items-center gap-2">
                {selectedConversation.status === 'BOT_ACTIVE' ? (
                  <button
                    type="button"
                    onClick={() =>
                      void handleHandoffToggle(
                        selectedConversation.id,
                        'TRANSFER_TO_AGENT'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand-gradient px-3.5 py-2 text-xs font-extrabold text-white shadow-brand-icon"
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    <span>Transferir a Chatwoot</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      void handleHandoffToggle(
                        selectedConversation.id,
                        'RETURN_TO_BOT'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl border border-soft-blue bg-soft-blue/10 px-3.5 py-2 text-xs font-extrabold text-soft-blue"
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    <span>Devolver Control al Bot (#bot)</span>
                  </button>
                )}
              </div>
            </div>

            <div className="my-3 flex flex-1 flex-col gap-3 overflow-y-auto rounded-2xl bg-soft-bg p-4">
              {selectedConversation.messages.map((msg) => {
                const isContact = msg.senderType === 'CONTACT';
                const isSystem = msg.senderType === 'SYSTEM';

                if (isSystem) {
                  return (
                    <div
                      key={msg.id}
                      className="mx-auto max-w-md rounded-xl border border-soft-warn/40 bg-soft-warn/10 px-3 py-2 text-center text-[11px] font-bold text-soft-ink"
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
                      className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-xs ${
                        isContact
                          ? 'border border-soft-line bg-soft-card text-soft-ink'
                          : 'bg-brand-gradient text-white shadow-brand-icon'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-3 text-[10px] opacity-80">
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
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between rounded-xl bg-soft-bg px-3.5 py-2 text-xs text-soft-muted">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Bot className="h-4 w-4 text-soft-blue" />
                Visor sincronizado en tiempo real con Chatwoot Inbox (Conversación #
                {selectedConversation.chatwootConversationId})
              </span>
              <span className="font-bold text-soft-ink">
                {selectedConversation.assignedAgentName ?? 'Automatizado por BotHub'}
              </span>
            </div>
          </div>
        ) : null}

        {selectedConversation ? (
          <div className="soft-card flex h-[560px] flex-col justify-between overflow-y-auto p-4">
            <div className="flex flex-col gap-4">
              <div>
                <span className="inline-flex items-center gap-1 text-xs font-extrabold uppercase tracking-wider text-soft-blue">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Variables Capturadas</span>
                </span>
                <div className="mt-2 flex flex-col gap-1.5">
                  {Object.entries(selectedConversation.collectedVariables).map(
                    ([k, v]) => (
                      <div
                        key={k}
                        className="flex items-center justify-between rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs"
                      >
                        <code className="font-bold text-soft-blue">{`{{${k}}}`}</code>
                        <span className="font-semibold text-soft-ink">{v}</span>
                      </div>
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
                      className="rounded-full bg-[#82d616]/15 px-2.5 py-1 text-[11px] font-extrabold text-[#4b830d]"
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
                  {selectedConversation.executionTrace.map((step, idx) => (
                    <div
                      key={`${step.nodeId}-${idx}`}
                      className="rounded-xl border border-soft-line bg-soft-bg p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <strong className="text-soft-ink">{step.title}</strong>
                        <span className="rounded bg-soft-blue/10 px-1.5 py-0.5 text-[10px] font-extrabold text-soft-blue">
                          {step.nodeType}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-soft-muted">
                        {step.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
