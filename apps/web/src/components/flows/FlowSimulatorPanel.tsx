import { FormEvent, KeyboardEvent, useState } from 'react';
import { Bot, Play, RotateCcw, Send, Sparkles, Tag } from 'lucide-react';
import {
  FlowExecutionStepLog,
  FlowSimulationBotReply
} from '@bothub/shared';
import { flowsApi } from '../../lib/api.js';

interface ChatBubble {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  buttons?: Array<{ id: string; label: string }>;
  listItems?: Array<{ id: string; title: string; description?: string }>;
  timestamp: string;
}

interface FlowSimulatorPanelProps {
  flowId: string;
  flowName: string;
  onHighlightNode?: (nodeId: string | null) => void;
}

export function FlowSimulatorPanel({
  flowId,
  flowName,
  onHighlightNode
}: FlowSimulatorPanelProps) {
  const [messages, setMessages] = useState<ChatBubble[]>([
    {
      id: 'init-bubble',
      sender: 'bot',
      text: `👋 Simulador listo para "${flowName}". Escribe "hola" para disparar el flujo y probar validaciones, botones, HTTP, IA y handoff.`,
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      })
    }
  ]);
  const [inputValue, setInputValue] = useState('hola');
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [awaitingQuestionNodeId, setAwaitingQuestionNodeId] = useState<string | null>(
    null
  );
  const [variables, setVariables] = useState<Record<string, string>>({
    nombre: 'Mariana Torres',
    telefono: '+57 301 554 9021'
  });
  const [tags, setTags] = useState<string[]>([]);
  const [traceLogs, setTraceLogs] = useState<FlowExecutionStepLog[]>([]);
  const [handoffBanner, setHandoffBanner] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  async function sendSimulatorInput(textToSend: string): Promise<void> {
    const trimmed = textToSend.trim();
    if (!trimmed || isSending) {
      return;
    }

    const nowTime = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    setMessages((prev) => [
      ...prev,
      {
        id: `usr-${Date.now()}`,
        sender: 'user',
        text: trimmed,
        timestamp: nowTime
      }
    ]);
    setInputValue('');
    setIsSending(true);

    try {
      const response = await flowsApi.simulateStep(flowId, {
        inputMessage: trimmed,
        currentNodeId,
        awaitingQuestionNodeId,
        variables,
        tags
      });

      const botBubbles: ChatBubble[] = response.replies.map(
        (reply: FlowSimulationBotReply) => ({
          id: reply.id,
          sender: 'bot',
          text: reply.text,
          buttons: reply.buttons,
          listItems: reply.listItems,
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          })
        })
      );

      setMessages((prev) => [...prev, ...botBubbles]);
      setCurrentNodeId(response.nextNodeId);
      setAwaitingQuestionNodeId(response.awaitingQuestionNodeId);
      setVariables(response.variables);
      setTags(response.tags);
      setTraceLogs((prev) => [...response.trace, ...prev]);

      if (response.handoffRequested && response.handoffSummary) {
        setHandoffBanner(response.handoffSummary);
      }

      if (onHighlightNode) {
        onHighlightNode(
          response.awaitingQuestionNodeId ??
            response.trace[response.trace.length - 1]?.nodeId ??
            null
        );
      }
    } finally {
      setIsSending(false);
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void sendSimulatorInput(inputValue);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendSimulatorInput(inputValue);
    }
  }

  function handleResetSession(): void {
    setCurrentNodeId(null);
    setAwaitingQuestionNodeId(null);
    setVariables({
      nombre: 'Mariana Torres',
      telefono: '+57 301 554 9021'
    });
    setTags([]);
    setTraceLogs([]);
    setHandoffBanner(null);
    setMessages([
      {
        id: `reset-${Date.now()}`,
        sender: 'bot',
        text: '🔄 Sesión reiniciada. Escribe "hola" para comenzar desde el nodo TRIGGER.',
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        })
      }
    ]);
    if (onHighlightNode) {
      onHighlightNode(null);
    }
  }

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-soft-line bg-soft-card p-4 shadow-soft">
      <div>
        <div className="flex items-center justify-between border-b border-soft-line pb-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-gradient text-white shadow-brand-icon">
              <Bot className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-xs font-extrabold text-soft-ink">
                Probador en Vivo (WhatsApp Sandbox)
              </h3>
              <p className="text-[11px] text-soft-muted">
                Ejecución real del motor de grafos
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleResetSession}
            title="Reiniciar sesión de prueba"
            className="inline-flex items-center gap-1 rounded-lg border border-soft-line bg-soft-bg px-2.5 py-1 text-[11px] font-bold text-soft-ink hover:border-soft-blue"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reiniciar</span>
          </button>
        </div>

        <div className="mt-3 flex h-64 flex-col gap-2.5 overflow-y-auto rounded-xl bg-soft-bg p-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.sender === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div
                className={`max-w-[90%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-brand-gradient text-white shadow-brand-icon'
                    : 'border border-soft-line bg-soft-card text-soft-ink'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.text}</p>

                {msg.buttons && msg.buttons.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {msg.buttons.map((btn) => (
                      <button
                        key={btn.id}
                        type="button"
                        onClick={() => void sendSimulatorInput(btn.label)}
                        className="w-full rounded-lg border border-soft-blue/40 bg-soft-blue/10 px-2.5 py-1.5 text-left text-[11px] font-extrabold text-soft-blue hover:bg-soft-blue hover:text-white"
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {msg.listItems && msg.listItems.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {msg.listItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void sendSimulatorInput(item.title)}
                        className="w-full rounded-lg border border-soft-line bg-soft-bg px-2.5 py-1.5 text-left text-[11px] hover:border-soft-blue"
                      >
                        <div className="font-extrabold text-soft-ink">
                          {item.title}
                        </div>
                        {item.description ? (
                          <div className="text-[10px] text-soft-muted">
                            {item.description}
                          </div>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <span className="mt-0.5 text-[10px] text-soft-muted">
                {msg.timestamp}
              </span>
            </div>
          ))}
        </div>

        {handoffBanner ? (
          <div className="mt-2.5 rounded-xl border border-[#82d616]/40 bg-[#82d616]/15 p-2.5 text-[11px] font-bold text-soft-ink">
            <strong>👨‍💼 Handoff a Chatwoot ejecutado:</strong> {handoffBanner}
          </div>
        ) : null}

        <form onSubmit={handleFormSubmit} className="mt-2.5 flex gap-2">
          <label htmlFor="sim-chat-input" className="sr-only">
            Mensaje de prueba
          </label>
          <input
            id="sim-chat-input"
            name="simulatorMessage"
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe aquí (ej: hola, 1020458912, 1)..."
            className="flex-1 rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink focus:border-soft-blue focus:outline-none"
          />
          <button
            type="submit"
            disabled={isSending}
            aria-label="Enviar mensaje de prueba"
            className="inline-flex items-center gap-1 rounded-xl bg-brand-gradient px-3.5 py-2 text-xs font-extrabold text-white shadow-brand-icon"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>

      <div className="mt-4 border-t border-soft-line pt-3">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase text-soft-blue">
            <Sparkles className="h-3 w-3" />
            <span>Variables de Sesión Capturadas</span>
          </span>
          {tags.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#82d616]">
              <Tag className="h-3 w-3" />
              {tags.join(', ')}
            </span>
          ) : null}
        </div>

        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {Object.entries(variables).map(([key, val]) => (
            <span
              key={key}
              className="rounded-lg border border-soft-line bg-soft-bg px-2 py-1 text-[10px] font-semibold text-soft-ink"
            >
              <strong className="text-soft-blue">{`{{${key}}}`}:</strong> {val}
            </span>
          ))}
        </div>

        {traceLogs.length > 0 ? (
          <div className="mt-2.5 max-h-28 overflow-y-auto rounded-xl bg-soft-bg p-2 text-[10px]">
            <div className="mb-1 font-extrabold uppercase text-soft-muted">
              Trazabilidad de Nodos Ejecutados:
            </div>
            {traceLogs.slice(0, 5).map((step, index) => (
              <div
                key={`${step.nodeId}-${index}`}
                className="flex items-center gap-1.5 py-0.5 text-soft-ink"
              >
                <Play className="h-2.5 w-2.5 shrink-0 text-soft-blue" />
                <strong>[{step.nodeType}]</strong>
                <span className="truncate">{step.detail}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
