import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, Lock, Palette, Plus, Trash2, Webhook } from 'lucide-react';
import { ApiKeyDto, OutboundWebhookConfigDto } from '@bothub/shared';
import { platformApi } from '../lib/api.js';
import { SidebarAccentColor, useThemeStore } from '../store/theme.store.js';

export function SettingsPage() {
  const { resolvedTheme, toggleLightDark, accentColor, setAccentColor } =
    useThemeStore();

  const [apiKeys, setApiKeys] = useState<ApiKeyDto[]>([]);
  const [webhooks, setWebhooks] = useState<OutboundWebhookConfigDto[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedRawKey, setGeneratedRawKey] = useState<string | null>(null);

  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('https://crm.empresa.local/webhooks/bothub');
  const [whSecret, setWhSecret] = useState('whsec_bothub_2026_secret');

  useEffect(() => {
    async function loadSettings(): Promise<void> {
      const res = await platformApi.getSettingsOverview();
      setApiKeys(res.apiKeys);
      setWebhooks(res.outboundWebhooks);
    }
    void loadSettings();
  }, []);

  async function handleCreateKey(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!newKeyName.trim()) return;
    const { apiKey } = await platformApi.createApiKey(newKeyName.trim(), [
      'bots:read',
      'flows:execute',
      'webhooks:write'
    ]);
    setApiKeys((prev) => [apiKey, ...prev]);
    setGeneratedRawKey(apiKey.rawKeyPreview ?? null);
    setNewKeyName('');
  }

  async function handleDeleteKey(id: string): Promise<void> {
    await platformApi.deleteApiKey(id);
    setApiKeys((prev) => prev.filter((k) => k.id !== id));
  }

  async function handleCreateWebhook(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    if (!whName.trim() || !whUrl.trim()) return;
    const { webhook } = await platformApi.createWebhook({
      name: whName.trim(),
      targetUrl: whUrl.trim(),
      events: ['conversation.handoff', 'contact.captured', 'bot.disconnected'],
      secretToken: whSecret.trim(),
      isActive: true
    });
    setWebhooks((prev) => [webhook, ...prev]);
    setWhName('');
  }

  const accents: Array<{ id: SidebarAccentColor; label: string }> = [
    { id: 'blue', label: 'Soft Blue' },
    { id: 'purple', label: 'Soft Purple' },
    { id: 'emerald', label: 'Soft Emerald' },
    { id: 'orange', label: 'Soft Orange' },
    { id: 'slate', label: 'Dark Slate' }
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="soft-card p-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-soft-blue/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
          <Lock className="h-3.5 w-3.5" />
          <span>Seguridad Criptográfica & Preferencias Soft UI</span>
        </span>
        <h1 className="mt-1.5 text-xl font-extrabold text-soft-ink">
          Configuración General de Plataforma
        </h1>
        <p className="mt-0.5 text-xs text-soft-muted">
          Personaliza la apariencia del panel, genera API Keys con CSPRNG y registra webhooks salientes cifrados con AES-256-GCM.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-soft-line bg-soft-bg p-4">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase text-soft-blue">
              <Palette className="h-4 w-4" />
              <span>Apariencia Soft UI Dashboard</span>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-soft-ink">
                Modo Visual Actual: <strong>{resolvedTheme.toUpperCase()}</strong>
              </span>
              <button
                type="button"
                onClick={toggleLightDark}
                className="rounded-xl bg-brand-gradient px-3.5 py-2 text-xs font-extrabold text-white shadow-brand-icon"
              >
                Alternar Claro / Oscuro
              </button>
            </div>

            <div className="mt-4">
              <span className="block text-xs font-bold text-soft-ink">
                Color de Acento del Menú Lateral:
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {accents.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => setAccentColor(acc.id)}
                    className={`rounded-xl border px-3 py-1.5 text-xs font-extrabold ${
                      accentColor === acc.id
                        ? 'border-soft-blue bg-soft-card text-soft-blue shadow-soft'
                        : 'border-soft-line bg-soft-card text-soft-ink'
                    }`}
                  >
                    {acc.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-soft-line bg-soft-bg p-4">
            <span className="text-xs font-extrabold uppercase text-[#82d616]">
              Estado de Cumplimiento Security & Crypto
            </span>
            <ul className="mt-2.5 flex flex-col gap-1.5 text-xs text-soft-ink">
              <li>✅ <strong>Cifrado en Reposo:</strong> AES-256-GCM (IV 12B + AuthTag 16B)</li>
              <li>✅ <strong>Hashing de Contraseñas:</strong> bcrypt (12 salt rounds)</li>
              <li>✅ <strong>Webhooks Seguros:</strong> Verificación en tiempo constante (timingSafeEqual)</li>
              <li>✅ <strong>Sesiones JWT:</strong> Access Token + Rotación de Refresh Tokens</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="soft-card flex flex-col justify-between p-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-extrabold text-soft-ink">
              <KeyRound className="h-4 w-4 text-soft-blue" />
              <span>Llaves de API (CSPRNG)</span>
            </div>

            {generatedRawKey ? (
              <div className="mt-3 rounded-xl border border-[#82d616]/50 bg-[#82d616]/15 p-3 text-xs">
                <strong className="block text-soft-ink">
                  🔑 Copia tu nueva llave ahora (solo se muestra una vez):
                </strong>
                <code className="mt-1 block break-all font-mono font-bold text-soft-blue">
                  {generatedRawKey}
                </code>
              </div>
            ) : null}

            <div className="mt-3 flex flex-col gap-2">
              {apiKeys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center justify-between rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2.5 text-xs"
                >
                  <div>
                    <strong className="text-soft-ink">{k.name}</strong>
                    <div className="font-mono text-[11px] text-soft-muted">
                      {k.keyPrefix}••••••••
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeleteKey(k.id)}
                    aria-label={`Revocar llave ${k.name}`}
                    className="rounded-lg p-1.5 text-soft-danger hover:bg-soft-danger/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleCreateKey} className="mt-4 flex gap-2">
            <label htmlFor="api-key-name" className="sr-only">
              Nombre de la API Key
            </label>
            <input
              id="api-key-name"
              type="text"
              required
              placeholder="Ej: Integración ERP / n8n..."
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="flex-1 rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-xl bg-brand-gradient px-4 py-2 text-xs font-extrabold text-white shadow-brand-icon"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Generar Key</span>
            </button>
          </form>
        </div>

        <div className="soft-card flex flex-col justify-between p-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-extrabold text-soft-ink">
              <Webhook className="h-4 w-4 text-soft-blue" />
              <span>Webhooks Salientes</span>
            </div>

            <div className="mt-3 flex flex-col gap-2">
              {webhooks.map((wh) => (
                <div
                  key={wh.id}
                  className="rounded-xl border border-soft-line bg-soft-bg p-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-soft-ink">{wh.name}</strong>
                    <span className="font-mono text-[10px] text-soft-blue">
                      {wh.maskedSecret}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-soft-muted">
                    {wh.targetUrl}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleCreateWebhook} className="mt-4 flex flex-col gap-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="wh-name"
                  className="mb-1 block text-[11px] font-bold text-soft-ink"
                >
                  Nombre del Webhook
                </label>
                <input
                  id="wh-name"
                  type="text"
                  required
                  placeholder="Ej: Notificador CRM"
                  value={whName}
                  onChange={(e) => setWhName(e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-xs text-soft-ink"
                />
              </div>
              <div>
                <label
                  htmlFor="wh-sec"
                  className="mb-1 block text-[11px] font-bold text-soft-ink"
                >
                  Secreto de Firma HMAC
                </label>
                <input
                  id="wh-sec"
                  type="password"
                  required
                  value={whSecret}
                  onChange={(e) => setWhSecret(e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-xs text-soft-ink"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="wh-url"
                className="mb-1 block text-[11px] font-bold text-soft-ink"
              >
                URL Destino (HTTPS)
              </label>
              <input
                id="wh-url"
                type="url"
                required
                value={whUrl}
                onChange={(e) => setWhUrl(e.target.value)}
                className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-xs text-soft-ink"
              />
            </div>
            <button
              type="submit"
              className="mt-1 rounded-xl bg-brand-gradient py-2 text-xs font-extrabold text-white shadow-brand-icon"
            >
              + Registrar Webhook Saliente
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
