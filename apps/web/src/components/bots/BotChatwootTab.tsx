import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Copy, RefreshCw, Wifi } from 'lucide-react';
import { BotDto } from '@bothub/shared';
import { botsApi } from '../../lib/api.js';

interface BotChatwootTabProps {
  selectedBot: BotDto;
  onBotUpdated: (bot: BotDto) => void;
  onFeedback: (type: 'ok' | 'err', text: string) => void;
}

function generateClientWebhookSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `whsec_${hex}`;
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
  const [cwUserApiToken, setCwUserApiToken] = useState('');
  const [cwWebhookToken, setCwWebhookToken] = useState('');
  const [cwReturnCommand, setCwReturnCommand] = useState('#bot');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (selectedBot.chatwootConfig) {
      setCwBaseUrl(selectedBot.chatwootConfig.baseUrl);
      setCwAccountId(String(selectedBot.chatwootConfig.accountId));
      setCwInboxId(String(selectedBot.chatwootConfig.inboxId));
      setCwReturnCommand(selectedBot.chatwootConfig.handoffReturnCommand);
      setCwApiToken('');
      setCwUserApiToken('');
      setCwWebhookToken('');
    } else {
      setCwBaseUrl('');
      setCwAccountId('1');
      setCwInboxId('1');
      setCwApiToken('');
      setCwUserApiToken('');
      setCwReturnCommand('#bot');
      setCwWebhookToken(generateClientWebhookSecret());
    }
  }, [selectedBot.id, selectedBot.chatwootConfig]);

  const currentOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';
  const baseWebhookUrl = `${currentOrigin}/api/webhooks/chatwoot/${selectedBot.id}`;
  const fullChatwootWebhookUrl = cwWebhookToken.trim()
    ? `${baseWebhookUrl}?token=${encodeURIComponent(cwWebhookToken.trim())}`
    : baseWebhookUrl;

  async function handleCopyChatwootWebhookUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(fullChatwootWebhookUrl);
      onFeedback(
        'ok',
        cwWebhookToken.trim()
          ? 'URL de Webhook con token copiada al portapapeles. Pégala en Chatwoot.'
          : 'URL base de Webhook copiada. Configura la cabecera x-chatwoot-webhook-token o genera un nuevo token.'
      );
    } catch {
      onFeedback('ok', `Copia esta URL en Chatwoot: ${fullChatwootWebhookUrl}`);
    }
  }

  async function handleSaveChatwoot(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSaving) return;
    const parsedAccountId = Number(cwAccountId);
    const parsedInboxId = Number(cwInboxId);
    if (!Number.isInteger(parsedAccountId) || parsedAccountId <= 0) {
      onFeedback('err', 'Account ID debe ser un número entero positivo.');
      return;
    }
    if (!Number.isInteger(parsedInboxId) || parsedInboxId <= 0) {
      onFeedback('err', 'Inbox ID debe ser un número entero positivo.');
      return;
    }
    if (!selectedBot.chatwootConfig?.hasApiAccessToken && cwApiToken.trim().length < 6) {
      onFeedback('err', 'El Token de Acceso API de Chatwoot debe tener al menos 6 caracteres.');
      return;
    }
    if (cwApiToken.trim().length > 0 && cwApiToken.trim().length < 6) {
      onFeedback('err', 'El nuevo Token de Acceso API debe tener al menos 6 caracteres.');
      return;
    }
    if (cwWebhookToken.trim().length > 0 && cwWebhookToken.trim().length < 6) {
      onFeedback('err', 'El Token de Webhook debe tener al menos 6 caracteres.');
      return;
    }

    setIsSaving(true);
    try {
      const { bot } = await botsApi.saveChatwoot(selectedBot.id, {
        baseUrl: cwBaseUrl.trim(),
        accountId: parsedAccountId,
        inboxId: parsedInboxId,
        apiAccessToken: cwApiToken.trim(),
        userApiAccessToken: cwUserApiToken.trim(),
        webhookToken: cwWebhookToken.trim(),
        handoffReturnCommand: cwReturnCommand.trim() || '#bot',
        isActive: true
      });
      onBotUpdated(bot);
      setCwApiToken('');
      setCwUserApiToken('');
      onFeedback(
        'ok',
        'Bot conectado con Chatwoot y credenciales cifradas con AES-256-GCM.'
      );
    } catch (err) {
      onFeedback(
        'err',
        err instanceof Error ? err.message : 'Error guardando la configuración de Chatwoot.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTestChatwoot(): Promise<void> {
    if (isTesting) return;
    setIsTesting(true);
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
    } finally {
      setIsTesting(false);
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
              Por seguridad, el secreto guardado no se reexpone en GET. Usa la cabecera <code>x-chatwoot-webhook-token</code> o genera un nuevo token para copiar la URL completa.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleCopyChatwootWebhookUrl()}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-brand-gradient px-3.5 py-2 text-xs font-extrabold text-white shadow-brand-icon"
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
              placeholder="https://chat.miempresa.com"
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
                type="number"
                min={1}
                step={1}
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
                type="number"
                min={1}
                step={1}
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
              minLength={selectedBot.chatwootConfig?.hasApiAccessToken ? undefined : 6}
              required={!selectedBot.chatwootConfig?.hasApiAccessToken}
              placeholder={
                selectedBot.chatwootConfig?.hasApiAccessToken
                  ? 'Token guardado (deja vacío para conservar el actual)'
                  : 'Pega el "Token de acceso" de tu Bot en Chatwoot'
              }
              value={cwApiToken}
              onChange={(e) => setCwApiToken(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-card px-3.5 py-2 text-xs text-soft-ink"
            />
          </div>

          <div>
            <label
              htmlFor="cw-user-api-token"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Token de Usuario / Admin Chatwoot (Opcional · Para Etiquetas)
            </label>
            <input
              id="cw-user-api-token"
              name="userApiAccessToken"
              type="password"
              placeholder={
                selectedBot.chatwootConfig?.hasUserApiAccessToken
                  ? `Guardado (${selectedBot.chatwootConfig.maskedUserApiAccessToken}) · deja vacío para conservar`
                  : 'Tu Access Token de Perfil en Chatwoot (necesario si el bot es Agent Bot)'
              }
              value={cwUserApiToken}
              onChange={(e) => setCwUserApiToken(e.target.value)}
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
              <div className="mb-1 flex items-center justify-between gap-2">
                <label
                  htmlFor="cw-webhook-token"
                  className="block text-xs font-bold text-soft-ink"
                >
                  Token Secreto del Webhook
                </label>
                <button
                  type="button"
                  onClick={() => setCwWebhookToken(generateClientWebhookSecret())}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-soft-blue hover:underline"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Rotar token</span>
                </button>
              </div>
              <input
                id="cw-webhook-token"
                name="webhookToken"
                type="text"
                required={!selectedBot.chatwootConfig}
                placeholder={
                  selectedBot.chatwootConfig
                    ? `Token actual: ${selectedBot.chatwootConfig.webhookTokenPreview} (deja vacío para conservar)`
                    : 'Token secreto CSPRNG'
                }
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
                minLength={2}
                maxLength={40}
                required
                value={cwReturnCommand}
                onChange={(e) => setCwReturnCommand(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3.5 py-2 text-xs text-soft-ink"
              />
            </div>
            {selectedBot.chatwootConfig ? (
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#4b830d] dark:text-[#82d616]">
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
              disabled={isSaving}
              className="min-h-[42px] flex-1 rounded-xl bg-brand-gradient py-2.5 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
            >
              {isSaving ? 'Guardando...' : 'Guardar Configuración Chatwoot'}
            </button>
            <button
              type="button"
              disabled={isTesting}
              onClick={() => void handleTestChatwoot()}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-soft-line bg-soft-card px-4 py-2.5 text-xs font-extrabold text-soft-ink hover:border-soft-blue disabled:opacity-60"
            >
              <Wifi className="h-3.5 w-3.5 text-[#82d616]" />
              <span>{isTesting ? 'Probando...' : 'Probar Conexión'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
