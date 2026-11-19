import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Copy, Wifi } from 'lucide-react';
import { BotDto } from '@bothub/shared';
import { botsApi } from '../../lib/api.js';

interface BotChatwootTabProps {
  selectedBot: BotDto;
  onBotUpdated: (bot: BotDto) => void;
  onFeedback: (type: 'ok' | 'err', text: string) => void;
}

export function BotChatwootTab({
  selectedBot,
  onBotUpdated,
  onFeedback
}: BotChatwootTabProps) {
  const [cwBaseUrl, setCwBaseUrl] = useState('');
  const [cwAccountId, setCwAccountId] = useState('1');
  const [cwInboxId, setCwInboxId] = useState('1');
  const [cwApiToken, setCwApiToken] = useState('');
  const [cwWebhookToken, setCwWebhookToken] = useState('');
  const [cwReturnCommand, setCwReturnCommand] = useState('#bot');

  const defaultWebhookSecret = `whsec_${selectedBot.id.replace(/[^a-zA-Z0-9]/g, '')}_2026`;

  useEffect(() => {
    if (selectedBot.chatwootConfig) {
      setCwBaseUrl(selectedBot.chatwootConfig.baseUrl);
      setCwAccountId(String(selectedBot.chatwootConfig.accountId));
      setCwInboxId(String(selectedBot.chatwootConfig.inboxId));
      setCwReturnCommand(selectedBot.chatwootConfig.handoffReturnCommand);
      const tokenMatch =
        selectedBot.chatwootConfig.webhookEndpointPath.split('?token=')[1];
      setCwWebhookToken(
        tokenMatch ? decodeURIComponent(tokenMatch) : defaultWebhookSecret
      );
    } else {
      setCwBaseUrl('');
      setCwAccountId('1');
      setCwInboxId('1');
      setCwApiToken('');
      setCwReturnCommand('#bot');
      setCwWebhookToken(defaultWebhookSecret);
    }
  }, [selectedBot.id, selectedBot.chatwootConfig, defaultWebhookSecret]);

  const effectiveWebhookToken = cwWebhookToken.trim() || defaultWebhookSecret;
  const currentOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const fullChatwootWebhookUrl = `${currentOrigin}/api/webhooks/chatwoot/${selectedBot.id}?token=${encodeURIComponent(effectiveWebhookToken)}`;

  async function handleCopyChatwootWebhookUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(fullChatwootWebhookUrl);
      onFeedback(
        'ok',
        'URL de Webhook copiada al portapapeles. Pégala en el campo "URL de Webhook" de tu Bot en Chatwoot.'
      );
    } catch {
      onFeedback('ok', `Copia esta URL en Chatwoot: ${fullChatwootWebhookUrl}`);
    }
  }

  async function handleSaveChatwoot(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const { bot } = await botsApi.saveChatwoot(selectedBot.id, {
      baseUrl: cwBaseUrl.trim(),
      accountId: Number(cwAccountId) || 1,
      inboxId: Number(cwInboxId) || 1,
      apiAccessToken: cwApiToken.trim(),
      webhookToken: effectiveWebhookToken,
      handoffReturnCommand: cwReturnCommand.trim() || '#bot',
      isActive: true
    });
    onBotUpdated(bot);
    onFeedback(
      'ok',
      'Bot conectado con Chatwoot y credenciales cifradas con AES-256-GCM.'
    );
  }

  async function handleTestChatwoot(): Promise<void> {
    try {
      const res = await botsApi.testChatwoot(selectedBot.id);
      if (res.bot) {
        onBotUpdated(res.bot);
      }
      onFeedback('ok', `${res.message} · Latencia: ${res.latencyMs}ms`);
    } catch (err) {
      try {
        const { bot } = await botsApi.getById(selectedBot.id);
        onBotUpdated(bot);
      } catch {
        void 0;
      }
      onFeedback(
        'err',
        err instanceof Error
          ? err.message
          : 'Guarda primero las credenciales de Chatwoot antes de probar.'
      );
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      <div className="rounded-2xl border border-soft-blue/30 bg-soft-blue/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-extrabold uppercase tracking-wider text-soft-blue">
              URL de Webhook para pegar en tu Bot de Chatwoot (Editar bot → URL de Webhook)
            </span>
            <p className="mt-0.5 text-xs text-soft-muted">
              Modo Solo Chatwoot (Agent Bot): Si tu canal ya está en Chatwoot, solo guarda esta pestaña y pega esta URL en la ventana &quot;Editar bot&quot; de Chatwoot.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleCopyChatwootWebhookUrl()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-gradient px-3.5 py-2 text-xs font-extrabold text-white shadow-brand-icon"
          >
            <Copy className="h-3.5 w-3.5" />
            <span>Copiar URL de Webhook</span>
          </button>
        </div>
        <input
          type="text"
          readOnly
          aria-label="URL de Webhook para Chatwoot"
          value={fullChatwootWebhookUrl}
          onClick={(e) => e.currentTarget.select()}
          className="mt-2.5 w-full rounded-xl border border-soft-line bg-soft-card px-3.5 py-2 font-mono text-xs font-bold text-soft-ink"
        />
      </div>

      <form
        onSubmit={handleSaveChatwoot}
        className="grid grid-cols-1 gap-6 lg:grid-cols-2"
      >
        <div className="flex flex-col gap-3 rounded-2xl border border-soft-line bg-soft-bg p-5">
          <span className="text-xs font-extrabold uppercase tracking-wider text-soft-blue">
            Parámetros de Instancia Chatwoot
          </span>
          <div>
            <label
              htmlFor="cw-base-url"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              URL Base de Chatwoot
            </label>
            <input
              id="cw-base-url"
              name="baseUrl"
              type="url"
              required
              placeholder="https://chat.bytemv.com"
              value={cwBaseUrl}
              onChange={(e) => setCwBaseUrl(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-card px-3.5 py-2 text-xs text-soft-ink"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="cw-account-id"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Account ID
              </label>
              <input
                id="cw-account-id"
                name="accountId"
                type="text"
                inputMode="numeric"
                required
                value={cwAccountId}
                onChange={(e) => setCwAccountId(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3.5 py-2 text-xs text-soft-ink"
              />
            </div>
            <div>
              <label
                htmlFor="cw-inbox-id"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Inbox ID
              </label>
              <input
                id="cw-inbox-id"
                name="inboxId"
                type="text"
                inputMode="numeric"
                required
                value={cwInboxId}
                onChange={(e) => setCwInboxId(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3.5 py-2 text-xs text-soft-ink"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="cw-api-token"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Token de Acceso del Bot de Chatwoot (API Access Token)
            </label>
            <input
              id="cw-api-token"
              name="apiAccessToken"
              type="password"
              required={!selectedBot.chatwootConfig?.hasApiAccessToken}
              placeholder={
                selectedBot.chatwootConfig?.hasApiAccessToken
                  ? 'Token guardado (deja vacío o pega uno nuevo)'
                  : 'Pega el "Token de acceso" de tu Bot en Chatwoot'
              }
              value={cwApiToken}
              onChange={(e) => setCwApiToken(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-card px-3.5 py-2 text-xs text-soft-ink"
            />
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-2xl border border-soft-line bg-soft-bg p-5">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-extrabold uppercase tracking-wider text-soft-blue">
              Handoff Bidireccional & Prevención de Loops
            </span>
            <div>
              <label
                htmlFor="cw-webhook-token"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Token Secreto del Webhook (Incluido en la URL de arriba)
              </label>
              <input
                id="cw-webhook-token"
                name="webhookToken"
                type="text"
                required
                value={cwWebhookToken}
                onChange={(e) => setCwWebhookToken(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3.5 py-2 text-xs text-soft-ink"
              />
            </div>
            <div>
              <label
                htmlFor="cw-return-cmd"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Comando de Retorno al Bot (Ej: #bot)
              </label>
              <input
                id="cw-return-cmd"
                name="handoffReturnCommand"
                type="text"
                required
                value={cwReturnCommand}
                onChange={(e) => setCwReturnCommand(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3.5 py-2 text-xs text-soft-ink"
              />
            </div>
            {selectedBot.chatwootConfig ? (
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#82d616]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>
                  Token cifrado activo: {selectedBot.chatwootConfig.maskedApiAccessToken}
                </span>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2.5">
            <button
              type="submit"
              className="flex-1 rounded-xl bg-brand-gradient py-2.5 text-xs font-extrabold text-white shadow-brand-icon"
            >
              Guardar Configuración Chatwoot
            </button>
            <button
              type="button"
              onClick={() => void handleTestChatwoot()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-soft-line bg-soft-card px-4 py-2.5 text-xs font-extrabold text-soft-ink hover:border-soft-blue"
            >
              <Wifi className="h-3.5 w-3.5 text-[#82d616]" />
              <span>Probar Conexión</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
