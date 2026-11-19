import { useEffect, useState } from 'react';
import { MessageSquare, QrCode, Sparkles } from 'lucide-react';
import { BotDto, FlowDto } from '@bothub/shared';
import { BotWhatsAppTab } from './BotWhatsAppTab.js';
import { BotChatwootTab } from './BotChatwootTab.js';
import { BotScheduleFaqTab } from './BotScheduleFaqTab.js';

type BotConfigTab = 'whatsapp' | 'chatwoot' | 'schedule';

interface BotConfigTabsProps {
  selectedBot: BotDto;
  flows: FlowDto[];
  onBotUpdated: (bot: BotDto) => void;
  onFeedback: (type: 'ok' | 'err', text: string) => void;
}

export function BotConfigTabs({
  selectedBot,
  flows,
  onBotUpdated,
  onFeedback
}: BotConfigTabsProps) {
  const isChatwootOnlyBot = selectedBot.driver === 'CHATWOOT';
  const [activeTab, setActiveTab] = useState<BotConfigTab>(
    isChatwootOnlyBot ? 'chatwoot' : 'whatsapp'
  );

  useEffect(() => {
    setActiveTab(selectedBot.driver === 'CHATWOOT' ? 'chatwoot' : 'whatsapp');
  }, [selectedBot.id, selectedBot.driver]);

  return (
    <section className="soft-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-soft-line pb-4">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
            Configuración Detallada del Bot
          </span>
          <h2 className="text-lg font-extrabold text-soft-ink">
            {selectedBot.name} {selectedBot.phoneNumber ? `(${selectedBot.phoneNumber})` : ''}
          </h2>
        </div>

        <div
          role="tablist"
          aria-label="Pestañas de configuración del bot"
          className="flex flex-nowrap gap-2 overflow-x-auto"
        >
          {!isChatwootOnlyBot ? (
            <button
              id="tab-whatsapp"
              role="tab"
              aria-selected={activeTab === 'whatsapp'}
              type="button"
              onClick={() => setActiveTab('whatsapp')}
              className={`inline-flex flex-none items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition-all ${
                activeTab === 'whatsapp'
                  ? 'bg-brand-gradient text-white shadow-brand-icon'
                  : 'bg-soft-bg text-soft-ink'
              }`}
            >
              <QrCode className="h-3.5 w-3.5" />
              <span>
                {selectedBot.driver === 'BAILEYS'
                  ? '1. Conexión WhatsApp (Baileys QR)'
                  : '1. Conexión WhatsApp Cloud API'}
              </span>
            </button>
          ) : null}
          <button
            id="tab-chatwoot"
            role="tab"
            aria-selected={activeTab === 'chatwoot'}
            type="button"
            onClick={() => setActiveTab('chatwoot')}
            className={`inline-flex flex-none items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition-all ${
              activeTab === 'chatwoot'
                ? 'bg-brand-gradient text-white shadow-brand-icon'
                : 'bg-soft-bg text-soft-ink'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>
              {isChatwootOnlyBot
                ? '1. Integración Chatwoot (Agent Bot)'
                : '2. Integración Chatwoot'}
            </span>
          </button>
          <button
            id="tab-schedule"
            role="tab"
            aria-selected={activeTab === 'schedule'}
            type="button"
            onClick={() => setActiveTab('schedule')}
            className={`inline-flex flex-none items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition-all ${
              activeTab === 'schedule'
                ? 'bg-brand-gradient text-white shadow-brand-icon'
                : 'bg-soft-bg text-soft-ink'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              {isChatwootOnlyBot
                ? '2. Flujo Asignado, Horarios & FAQ'
                : '3. Flujo Asignado, Horarios & FAQ'}
            </span>
          </button>
        </div>
      </div>

      {!isChatwootOnlyBot && activeTab === 'whatsapp' ? (
        <BotWhatsAppTab
          selectedBot={selectedBot}
          onBotUpdated={onBotUpdated}
          onFeedback={onFeedback}
        />
      ) : null}

      {activeTab === 'chatwoot' ? (
        <BotChatwootTab
          selectedBot={selectedBot}
          onBotUpdated={onBotUpdated}
          onFeedback={onFeedback}
        />
      ) : null}

      {activeTab === 'schedule' ? (
        <BotScheduleFaqTab
          selectedBot={selectedBot}
          flows={flows}
          onBotUpdated={onBotUpdated}
          onFeedback={onFeedback}
        />
      ) : null}
    </section>
  );
}
