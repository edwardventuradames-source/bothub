import { FormEvent, useEffect, useState } from 'react';
import { Copy, Loader2, QrCode, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { BotDto } from '@bothub/shared';
import { botsApi } from '../../lib/api.js';

interface BotWhatsAppTabProps {
  selectedBot: BotDto;
  onBotUpdated: (bot: BotDto) => void;
  onFeedback: (type: 'ok' | 'err', text: string) => void;
}

export function BotWhatsAppTab({
  selectedBot,
  onBotUpdated,
  onFeedback
}: BotWhatsAppTabProps) {
  const [cloudPhoneId, setCloudPhoneId] = useState('');
  const [cloudWabaId, setCloudWabaId] = useState('');
  const [cloudAccessToken, setCloudAccessToken] = useState('');
  const [cloudVerifyToken, setCloudVerifyToken] = useState('');
  const [cloudAppSecret, setCloudAppSecret] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (selectedBot.cloudApiConfig) {
      setCloudPhoneId(selectedBot.cloudApiConfig.phoneNumberId);
      setCloudWabaId(selectedBot.cloudApiConfig.wabaId);
    } else {
      setCloudPhoneId('');
      setCloudWabaId('');
    }
    setCloudAccessToken('');
    setCloudVerifyToken('');
    setCloudAppSecret('');
  }, [selectedBot.id, selectedBot.cloudApiConfig]);

  async function handleGenerateQr(): Promise<void> {
    setIsBusy(true);
    try {
      const { bot } = await botsApi.generateQr(selectedBot.id);
      onBotUpdated(bot);
      onFeedback(
        'ok',
        `Sesión Baileys iniciada para ${bot.name}. Escanea el código QR cuando aparezca.`
      );
    } catch (err) {
      onFeedback(
        'err',
        err instanceof Error ? err.message : 'No se pudo iniciar la sesión Baileys.'
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDisconnect(): Promise<void> {
    setIsBusy(true);
    try {
      const { bot } = await botsApi.disconnect(selectedBot.id);
      onBotUpdated(bot);
      onFeedback('ok', `Sesión WhatsApp desconectada para ${bot.name}.`);
    } catch (err) {
      onFeedback(
        'err',
        err instanceof Error ? err.message : 'No se pudo desconectar la sesión.'
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSaveCloudApi(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsBusy(true);
    try {
      const { bot } = await botsApi.saveCloudApi(selectedBot.id, {
        phoneNumberId: cloudPhoneId.trim(),
        wabaId: cloudWabaId.trim(),
        accessToken: cloudAccessToken.trim() || undefined,
        verifyToken: cloudVerifyToken.trim() || undefined,
        appSecret: cloudAppSecret.trim() || undefined
      });
      onBotUpdated(bot);
      setCloudAccessToken('');
      setCloudVerifyToken('');
      setCloudAppSecret('');
      onFeedback('ok', 'WhatsApp Cloud API oficial configurada y activa.');
    } catch (err) {
      onFeedback(
        'err',
        err instanceof Error ? err.message : 'Error guardando credenciales Cloud API.'
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCopyCloudWebhook(): Promise<void> {
    const webhookUrl = `${window.location.origin}${selectedBot.cloudApiConfig?.webhookPath ?? `/api/webhooks/whatsapp-cloud/${selectedBot.id}`}`;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      onFeedback('ok', 'URL de Webhook Cloud API copiada al portapapeles.');
    } catch {
      onFeedback('err', 'No se pudo copiar la URL automáticamente.');
    }
  }

  if (selectedBot.driver === 'BAILEYS') {
    const hasRealQrImage =
      typeof selectedBot.qrCodeData === 'string' &&
      selectedBot.qrCodeData.startsWith('data:image/');

    return (
      <div className="mt-6 grid grid-cols-1 gap-6">
        <div className="rounded-2xl border border-soft-line bg-soft-bg p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold uppercase tracking-wider text-soft-blue">
              Motor Baileys Multi-Device (QR en Vivo)
            </span>
            <span className="rounded-lg bg-soft-card px-2.5 py-1 text-[11px] font-bold text-soft-ink">
              Cifrado AES-256-GCM
            </span>
          </div>

          <div className="mt-4 flex flex-col items-center justify-center rounded-2xl bg-soft-card p-6 shadow-soft">
            {selectedBot.status === 'CONNECTED' ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#82d616]/20 text-2xl">
                  ✅
                </span>
                <p className="text-sm font-extrabold text-soft-ink">
                  WhatsApp conectado ({selectedBot.phoneNumber || 'Dispositivo activo'})
                </p>
                <p className="text-xs text-soft-muted">
                  La sesión multi-device está activa y escuchando mensajes entrantes en tiempo real.
                </p>
              </div>
            ) : hasRealQrImage ? (
              <img
                src={selectedBot.qrCodeData ?? ''}
                alt="Código QR real de vinculación WhatsApp"
                className="h-64 w-64 rounded-xl border-4 border-white bg-white p-2 shadow-md"
              />
            ) : selectedBot.status === 'RECONNECTING' || isBusy ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <Loader2 className="h-10 w-10 animate-spin text-soft-blue" />
                <p className="text-xs font-bold text-soft-ink">
                  Conectando con servidores de WhatsApp para obtener código QR...
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <QrCode className="h-12 w-12 text-soft-muted" />
                <p className="text-xs font-bold text-soft-muted">
                  Presiona &quot;Generar Código QR&quot; para iniciar una sesión Baileys real y vincular tu teléfono.
                </p>
              </div>
            )}

            {selectedBot.status !== 'CONNECTED' ? (
              <p className="mt-3 text-center text-xs font-bold text-soft-ink">
                📱 Abre WhatsApp → Dispositivos vinculados → Vincular un dispositivo
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap justify-center gap-2.5">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleGenerateQr()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-gradient px-4 py-2 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                <span>
                  {selectedBot.status === 'CONNECTED'
                    ? 'Reiniciar Sesión y Generar QR'
                    : 'Generar Código QR'}
                </span>
              </button>

              {selectedBot.status === 'CONNECTED' ||
              selectedBot.status === 'WAITING_QR' ||
              selectedBot.status === 'RECONNECTING' ? (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleDisconnect()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs font-bold text-soft-danger hover:border-soft-danger disabled:opacity-60"
                >
                  <Unplug className="h-3.5 w-3.5" />
                  <span>Desconectar</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const hasExistingCloudConfig = Boolean(selectedBot.cloudApiConfig);
  const cloudWebhookUrl = `${window.location.origin}${selectedBot.cloudApiConfig?.webhookPath ?? `/api/webhooks/whatsapp-cloud/${selectedBot.id}`}`;

  return (
    <div className="mt-6 grid grid-cols-1 gap-6">
      <form
        onSubmit={handleSaveCloudApi}
        className="flex flex-col justify-between rounded-2xl border border-soft-line bg-soft-bg p-5"
      >
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-soft-blue">
              Driver Oficial WhatsApp Cloud API (Meta)
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#82d616]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Tokens Cifrados + Firma HMAC-SHA256
            </span>
          </div>

          <div className="mt-3 rounded-xl border border-soft-line bg-soft-card p-3">
            <span className="block text-[11px] font-bold text-soft-muted">
              Callback URL para Meta Developers Webhook:
            </span>
            <div className="mt-1 flex items-center justify-between gap-2">
              <code className="min-w-0 truncate text-[11px] font-bold text-soft-ink">
                {cloudWebhookUrl}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyCloudWebhook()}
                aria-label="Copiar URL de webhook Cloud API"
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-soft-line bg-soft-bg px-2.5 py-1.5 text-[11px] font-bold text-soft-ink hover:border-soft-blue"
              >
                <Copy className="h-3 w-3" />
                <span>Copiar</span>
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="cloud-phone-id"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Phone Number ID
              </label>
              <input
                id="cloud-phone-id"
                name="phoneNumberId"
                type="text"
                required
                value={cloudPhoneId}
                onChange={(e) => setCloudPhoneId(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs text-soft-ink"
              />
            </div>
            <div>
              <label
                htmlFor="cloud-waba-id"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                WABA Account ID
              </label>
              <input
                id="cloud-waba-id"
                name="wabaId"
                type="text"
                required
                value={cloudWabaId}
                onChange={(e) => setCloudWabaId(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs text-soft-ink"
              />
            </div>
          </div>

          <div className="mt-3">
            <label
              htmlFor="cloud-access-token"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Permanent Access Token (AES-256-GCM)
            </label>
            <input
              id="cloud-access-token"
              name="accessToken"
              type="password"
              required={!hasExistingCloudConfig}
              placeholder={
                selectedBot.cloudApiConfig?.hasAccessToken
                  ? `Token actual (${selectedBot.cloudApiConfig.maskedAccessToken}) — dejar vacío para conservar`
                  : 'EAAG...'
              }
              value={cloudAccessToken}
              onChange={(e) => setCloudAccessToken(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs text-soft-ink"
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="cloud-verify-token"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Webhook Verify Token
              </label>
              <input
                id="cloud-verify-token"
                name="verifyToken"
                type="text"
                required={!hasExistingCloudConfig}
                placeholder={
                  selectedBot.cloudApiConfig?.verifyTokenPreview
                    ? `Actual (${selectedBot.cloudApiConfig.verifyTokenPreview}) — vacío para conservar`
                    : 'Ej: verify_bothub_2026'
                }
                value={cloudVerifyToken}
                onChange={(e) => setCloudVerifyToken(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs text-soft-ink"
              />
            </div>
            <div>
              <label
                htmlFor="cloud-app-secret"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Meta App Secret (X-Hub-Signature-256)
              </label>
              <input
                id="cloud-app-secret"
                name="appSecret"
                type="password"
                placeholder={
                  selectedBot.cloudApiConfig?.hasAppSecret
                    ? 'Configurado — dejar vacío para conservar'
                    : 'Recomendado en producción'
                }
                value={cloudAppSecret}
                onChange={(e) => setCloudAppSecret(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs text-soft-ink"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={isBusy}
          className="mt-4 w-full rounded-xl bg-brand-gradient py-2.5 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
        >
          {isBusy ? 'Guardando credenciales...' : 'Guardar y Activar WhatsApp Cloud API'}
        </button>
      </form>
    </div>
  );
}
