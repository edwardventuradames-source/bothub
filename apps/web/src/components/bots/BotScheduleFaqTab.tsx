import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { BotDto, FlowDto } from '@bothub/shared';
import { botsApi } from '../../lib/api.js';

interface BotScheduleFaqTabProps {
  selectedBot: BotDto;
  flows: FlowDto[];
  onBotUpdated: (bot: BotDto) => void;
  onFeedback: (type: 'ok' | 'err', text: string) => void;
}

export function BotScheduleFaqTab({
  selectedBot,
  flows,
  onBotUpdated,
  onFeedback
}: BotScheduleFaqTabProps) {
  const navigate = useNavigate();
  const [newFaqTitle, setNewFaqTitle] = useState('');
  const [newFaqKeywords, setNewFaqKeywords] = useState('');
  const [newFaqResponse, setNewFaqResponse] = useState('');

  async function handleAssignFlow(flowId: string): Promise<void> {
    const { bot } = await botsApi.update(selectedBot.id, {
      activeFlowId: flowId || null
    });
    onBotUpdated(bot);
    onFeedback(
      'ok',
      `Flujo "${bot.activeFlowName ?? 'Ninguno'}" asignado a ${bot.name}.`
    );
  }

  async function handleAddQuickReply(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!newFaqTitle.trim() || !newFaqResponse.trim()) return;
    const keywords = newFaqKeywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const updatedReplies = [
      ...selectedBot.quickReplies,
      {
        id: `qr-${Date.now()}`,
        title: newFaqTitle.trim(),
        keywords: keywords.length > 0 ? keywords : [newFaqTitle.toLowerCase()],
        responseText: newFaqResponse.trim(),
        matchMode: 'CONTAINS' as const,
        isActive: true
      }
    ];
    const { bot } = await botsApi.update(selectedBot.id, {
      quickReplies: updatedReplies
    });
    onBotUpdated(bot);
    setNewFaqTitle('');
    setNewFaqKeywords('');
    setNewFaqResponse('');
    onFeedback('ok', 'Respuesta rápida agregada al bot.');
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4 rounded-2xl border border-soft-line bg-soft-bg p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold uppercase tracking-wider text-soft-blue">
            Flujo Visual Conectado al Bot
          </span>
          <button
            type="button"
            onClick={() => navigate('/flows')}
            className="inline-flex items-center gap-1 text-xs font-extrabold text-soft-blue hover:underline"
          >
            <span>Abrir Editor Visual React Flow</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>

        <div>
          <label
            htmlFor="assign-flow-select"
            className="mb-1.5 block text-xs font-bold text-soft-ink"
          >
            Seleccionar Flujo Principal para {selectedBot.name}
          </label>
          <select
            id="assign-flow-select"
            name="activeFlowId"
            value={selectedBot.activeFlowId ?? ''}
            onChange={(e) => void handleAssignFlow(e.target.value)}
            className="w-full rounded-xl border border-soft-line bg-soft-card px-3.5 py-2.5 text-xs font-bold text-soft-ink"
          >
            <option value="">Sin flujo asignado</option>
            {flows.map((flow) => (
              <option key={flow.id} value={flow.id}>
                {flow.name} (v{flow.activeVersionNumber})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-soft-line bg-soft-bg p-5">
        <span className="text-xs font-extrabold uppercase tracking-wider text-soft-blue">
          Respuestas Rápidas Automáticas (FAQ)
        </span>
        <form onSubmit={handleAddQuickReply} className="grid grid-cols-1 gap-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="faq-title"
                className="mb-1 block text-[11px] font-bold text-soft-ink"
              >
                Título FAQ
              </label>
              <input
                id="faq-title"
                name="title"
                type="text"
                required
                placeholder="Ej: Medios de Pago"
                value={newFaqTitle}
                onChange={(e) => setNewFaqTitle(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-1.5 text-xs text-soft-ink"
              />
            </div>
            <div>
              <label
                htmlFor="faq-keywords"
                className="mb-1 block text-[11px] font-bold text-soft-ink"
              >
                Palabras clave (coma)
              </label>
              <input
                id="faq-keywords"
                name="keywords"
                type="text"
                required
                placeholder="pago, nequi, pse"
                value={newFaqKeywords}
                onChange={(e) => setNewFaqKeywords(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-1.5 text-xs text-soft-ink"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="faq-response"
              className="mb-1 block text-[11px] font-bold text-soft-ink"
            >
              Respuesta automática
            </label>
            <input
              id="faq-response"
              name="responseText"
              type="text"
              required
              placeholder="Aceptamos PSE, tarjetas y transferencias."
              value={newFaqResponse}
              onChange={(e) => setNewFaqResponse(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-1.5 text-xs text-soft-ink"
            />
          </div>
          <button
            type="submit"
            className="rounded-xl bg-brand-gradient py-2 text-xs font-extrabold text-white shadow-brand-icon"
          >
            + Agregar Respuesta Rápida
          </button>
        </form>
      </div>
    </div>
  );
}
