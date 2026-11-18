import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  MessageSquare,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wifi
} from 'lucide-react';
import { BotDto, FlowDto } from '@bothub/shared';
import { botsApi } from '../../lib/api.js';

type BotConfigTab = 'whatsapp' | 'chatwoot' | 'schedule';

function renderQrMatrixPattern(seed: string): boolean[][] {
  const size = 15;
  const grid: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false)
  );

  const drawFinder = (startR: number, startC: number) => {
    for (let r = 0; r < 5; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        const isBorder = r === 0 || r === 4 || c === 0 || c === 4;
        const isCenter = r === 2 && c === 2;
        grid[startR + r][startC + c] = isBorder || isCenter;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 5);
  drawFinder(size - 5, 0);

  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const inFinder =
        (r < 6 && c < 6) ||
        (r < 6 && c >= size - 6) ||
        (r >= size - 6 && c < 6);
      if (!inFinder) {
        hash ^= (r * 31 + c * 17) & 0xff;
        hash = Math.imul(hash, 16777619);
        grid[r][c] = Math.abs(hash) % 2 === 0;
      }
    }
  }

  return grid;
}

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
  const navigate = useNavigate();
  const isChatwootOnlyBot = selectedBot.driver === 'CHATWOOT';
  const [activeTab, setActiveTab] = useState<BotConfigTab>(
    isChatwootOnlyBot ? 'chatwoot' : 'whatsapp'
  );

  const [cwBaseUrl, setCwBaseUrl] = useState('');
  const [cwAccountId, setCwAccountId] = useState('1');
  const [cwInboxId, setCwInboxId] = useState('1');
  const [cwApiToken, setCwApiToken] = useState('');
  const [cwWebhookToken, setCwWebhookToken] = useState('');
  const [cwReturnCommand, setCwReturnCommand] = useState('#bot');

  const [cloudPhoneId, setCloudPhoneId] = useState('');
  const [cloudWabaId, setCloudWabaId] = useState('');
  const [cloudAccessToken, setCloudAccessToken] = useState('');
  const [cloudVerifyToken, setCloudVerifyToken] = useState('');

  const [newFaqTitle, setNewFaqTitle] = useState('');
  const [newFaqKeywords, setNewFaqKeywords] = useState('');
  const [newFaqResponse, setNewFaqResponse] = useState('');

  const defaultWebhookSecret = `whsec_${selectedBot.id.replace(/[^a-zA-Z0-9]/g, '')}_2026`;

  useEffect(() => {
    setActiveTab(selectedBot.driver === 'CHATWOOT' ? 'chatwoot' : 'whatsapp');
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
    if (selectedBot.cloudApiConfig) {
      setCloudPhoneId(selectedBot.cloudApiConfig.phoneNumberId);
      setCloudWabaId(selectedBot.cloudApiConfig.wabaId);
    }
  }, [selectedBot.id, selectedBot.driver, defaultWebhookSecret]);

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

  async function handleGenerateQr(): Promise<void> {
    const { bot } = await botsApi.generateQr(selectedBot.id);
    onBotUpdated(bot);
    onFeedback('ok', `Nuevo código QR generado para ${bot.name}.`);
  }

  async function handleConfirmQr(): Promise<void> {
    const { bot } = await botsApi.confirmQr(selectedBot.id);
    onBotUpdated(bot);
    onFeedback(
      'ok',
      `Sesión WhatsApp vinculada y cifrada con AES-256-GCM para ${bot.name}.`
    );
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
      'Bot conectado con Chatwoot y credenciales cifradas con AES-256-GCM. Ahora copia la URL de Webhook y pégala en tu Bot de Chatwoot.'
    );
  }

  async function handleTestChatwoot(): Promise<void> {
    try {
      const res = await botsApi.testChatwoot(selectedBot.id);
      onFeedback('ok', `${res.message} · Latencia: ${res.latencyMs}ms`);
    } catch (err) {
      onFeedback(
        'err',
        err instanceof Error
          ? err.message
          : 'Guarda primero las credenciales de Chatwoot antes de probar.'
      );
    }
  }

  async function handleSaveCloudApi(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const { bot } = await botsApi.saveCloudApi(selectedBot.id, {
      phoneNumberId: cloudPhoneId.trim(),
      wabaId: cloudWabaId.trim(),
      accessToken: cloudAccessToken.trim(),
      verifyToken: cloudVerifyToken.trim()
    });
    onBotUpdated(bot);
    onFeedback('ok', 'WhatsApp Cloud API oficial configurada y activa.');
  }

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

  const qrMatrix = renderQrMatrixPattern(
    selectedBot.qrCodeData ?? selectedBot.id ?? 'bothub-qr'
  );

  return (
    <section className="soft-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-soft-line pb-4">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
            Configuración Detallada del Bot
          </span>
          <h2 className="text-lg font-extrabold text-soft-ink">
            {selectedBot.name} ({selectedBot.phoneNumber})
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
        <div className="mt-6 grid grid-cols-1 gap-6">
          {selectedBot.driver === 'BAILEYS' ? (
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
              <div
                aria-label="Código QR de vinculación WhatsApp"
                className="grid gap-1 rounded-xl border-4 border-white bg-white p-3 shadow-md"
                style={{ gridTemplateColumns: 'repeat(15, minmax(0, 1fr))' }}
              >
                {qrMatrix.flatMap((row, rIdx) =>
                  row.map((cell, cIdx) => (
                    <span
                      key={`${rIdx}-${cIdx}`}
                      className={`h-2.5 w-2.5 rounded-[2px] ${
                        cell ? 'bg-[#141727]' : 'bg-white'
                      }`}
                    />
                  ))
                )}
              </div>

              <p className="mt-3 text-center text-xs font-bold text-soft-ink">
                {selectedBot.status === 'CONNECTED'
                  ? '✅ Dispositivo vinculado y sesión activa en tiempo real'
                  : '📱 Abre WhatsApp -> Dispositivos vinculados -> Vincular un dispositivo'}
              </p>

              <div className="mt-4 flex flex-wrap justify-center gap-2.5">
                <button
                  type="button"
                  onClick={handleGenerateQr}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs font-bold text-soft-ink hover:border-soft-blue"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Generar Nuevo QR</span>
                </button>

                <button
                  type="button"
                  onClick={handleConfirmQr}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-gradient px-4 py-2 text-xs font-extrabold text-white shadow-brand-icon"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  <span>Simular Escaneo QR (Conectar)</span>
                </button>
              </div>
            </div>
          </div>
          ) : (
          <form
            onSubmit={handleSaveCloudApi}
            className="flex flex-col justify-between rounded-2xl border border-soft-line bg-soft-bg p-5"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-soft-blue">
                  Driver Oficial WhatsApp Cloud API (Meta)
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#82d616]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Tokens Cifrados
                </span>
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
                  required
                  value={cloudAccessToken}
                  onChange={(e) => setCloudAccessToken(e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs text-soft-ink"
                />
              </div>

              <div className="mt-3">
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
                  required
                  value={cloudVerifyToken}
                  onChange={(e) => setCloudVerifyToken(e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-card px-3 py-2 text-xs text-soft-ink"
                />
              </div>
            </div>

            <button
              type="submit"
              className="mt-4 w-full rounded-xl bg-brand-gradient py-2.5 text-xs font-extrabold text-white shadow-brand-icon"
            >
              Guardar y Activar WhatsApp Cloud API
            </button>
          </form>
          )}
        </div>
      ) : null}

      {activeTab === 'chatwoot' ? (
        <div className="mt-6 flex flex-col gap-5">
          <div className="rounded-2xl border border-soft-blue/30 bg-soft-blue/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-wider text-soft-blue">
                  URL de Webhook para pegar en tu Bot de Chatwoot (Editar bot → URL de Webhook)
                </span>
                <p className="mt-0.5 text-xs text-soft-muted">
                  Modo Solo Chatwoot (Agent Bot): Si tu canal ya está en Chatwoot, solo guarda esta pestaña y pega esta URL en la ventana &quot;Editar bot&quot; de Chatwoot. No necesitas configurar la pestaña 1 de WhatsApp.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopyChatwootWebhookUrl}
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
                  onClick={handleTestChatwoot}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-soft-line bg-soft-card px-4 py-2.5 text-xs font-extrabold text-soft-ink hover:border-soft-blue"
                >
                  <Wifi className="h-3.5 w-3.5 text-[#82d616]" />
                  <span>Probar Conexión</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {activeTab === 'schedule' ? (
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
                onChange={(e) => handleAssignFlow(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-card px-3.5 py-2.5 text-xs font-bold text-soft-ink"
              >
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
      ) : null}
    </section>
  );
}
