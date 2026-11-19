import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, Lock, Palette, Plus, Trash2, Webhook } from 'lucide-react';
import { ApiKeyDto, OutboundWebhookConfigDto } from '@bothub/shared';
import { platformApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.store.js';
import { SidebarAccentColor, useThemeStore } from '../store/theme.store.js';

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const canManageKeys = user?.role === 'ADMIN';
  const canManageWebhooks = user?.role === 'ADMIN' || user?.role === 'OPERATOR';

  const { resolvedTheme, toggleLightDark, accentColor, setAccentColor } =
    useThemeStore();

  const [apiKeys, setApiKeys] = useState<ApiKeyDto[]>([]);
  const [webhooks, setWebhooks] = useState<OutboundWebhookConfigDto[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedRawKey, setGeneratedRawKey] = useState<string | null>(null);

  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('');
  const [whSecret, setWhSecret] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittingKey, setIsSubmittingKey] = useState(false);
  const [isSubmittingWebhook, setIsSubmittingWebhook] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!canManageWebhooks) {
      return;
    }
    async function loadSettings(): Promise<void> {
      setIsLoading(true);
      try {
        const res = await platformApi.getSettingsOverview();
        setApiKeys(res.apiKeys);
        setWebhooks(res.outboundWebhooks);
      } catch (err) {
        setFeedback({
          type: 'err',
          text:
            err instanceof Error
              ? err.message
              : 'No se pudo cargar la configuración de integraciones.'
        });
      } finally {
        setIsLoading(false);
      }
    }
    void loadSettings();
  }, [canManageWebhooks]);

  async function handleCreateKey(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canManageKeys || isSubmittingKey || newKeyName.trim().length < 2) return;
    setIsSubmittingKey(true);
    setFeedback(null);
    try {
      const { apiKey } = await platformApi.createApiKey(newKeyName.trim(), [
        'bots:read',
        'flows:execute',
        'webhooks:write'
      ]);
      setApiKeys((prev) => [apiKey, ...prev]);
      setGeneratedRawKey(apiKey.rawKeyPreview ?? null);
      setNewKeyName('');
      setFeedback({ type: 'ok', text: `Llave "${apiKey.name}" generada correctamente.` });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error generando la API Key.'
      });
    } finally {
      setIsSubmittingKey(false);
    }
  }

  async function handleDeleteKey(id: string, name: string): Promise<void> {
    if (!canManageKeys) return;
    if (!window.confirm(`¿Revocar la API Key "${name}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    try {
      await platformApi.deleteApiKey(id);
      setApiKeys((prev) => prev.filter((k) => k.id !== id));
      setFeedback({ type: 'ok', text: `API Key "${name}" revocada.` });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo revocar la API Key.'
      });
    }
  }

  async function handleCreateWebhook(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    if (!canManageWebhooks || isSubmittingWebhook) return;
    if (whName.trim().length < 2 || whSecret.trim().length < 8 || !whUrl.trim()) {
      setFeedback({
        type: 'err',
        text: 'Verifica nombre (mín. 2), URL válida y secreto HMAC (mín. 8 caracteres).'
      });
      return;
    }
    setIsSubmittingWebhook(true);
    setFeedback(null);
    try {
      const { webhook } = await platformApi.createWebhook({
        name: whName.trim(),
        targetUrl: whUrl.trim(),
        events: ['conversation.handoff', 'contact.captured', 'bot.disconnected'],
        secretToken: whSecret.trim(),
        isActive: true
      });
      setWebhooks((prev) => [webhook, ...prev]);
      setWhName('');
      setWhUrl('');
      setWhSecret('');
      setFeedback({ type: 'ok', text: `Webhook "${webhook.name}" registrado y cifrado.` });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo registrar el webhook saliente.'
      });
    } finally {
      setIsSubmittingWebhook(false);
    }
  }

  async function handleDeleteWebhook(id: string, name: string): Promise<void> {
    if (!canManageWebhooks) return;
    if (!window.confirm(`¿Eliminar el webhook saliente "${name}"?`)) {
      return;
    }
    try {
      await platformApi.deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      setFeedback({ type: 'ok', text: `Webhook "${name}" eliminado.` });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo eliminar el webhook.'
      });
    }
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
                className="min-h-[40px] rounded-xl bg-brand-gradient px-3.5 py-2 text-xs font-extrabold text-white shadow-brand-icon"
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
                    className={`min-h-[38px] rounded-xl border px-3 py-1.5 text-xs font-extrabold ${
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
            <span className="text-xs font-extrabold uppercase text-[#4b830d] dark:text-[#82d616]">
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

      {feedback ? (
        <div
          role={feedback.type === 'err' ? 'alert' : 'status'}
          className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-xs font-bold ${
            feedback.type === 'ok'
              ? 'border-[#82d616]/40 bg-[#82d616]/15 text-soft-ink'
              : 'border-soft-danger/40 bg-soft-danger/15 text-soft-danger'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline"
          >
            Cerrar
          </button>
        </div>
      ) : null}

      {canManageWebhooks ? (
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {canManageKeys ? (
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
                  {isLoading ? (
                    <p className="text-xs text-soft-muted">Cargando llaves...</p>
                  ) : apiKeys.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-soft-line bg-soft-bg p-4 text-xs text-soft-muted">
                      No hay llaves API activas en tu organización.
                    </p>
                  ) : (
                    apiKeys.map((k) => (
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
                          onClick={() => void handleDeleteKey(k.id, k.name)}
                          aria-label={`Revocar llave ${k.name}`}
                          className="min-h-[40px] min-w-[40px] grid place-items-center rounded-lg p-1.5 text-soft-danger hover:bg-soft-danger/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <form onSubmit={handleCreateKey} className="mt-4 flex flex-wrap gap-2">
                <label htmlFor="api-key-name" className="sr-only">
                  Nombre de la API Key
                </label>
                <input
                  id="api-key-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="Ej: Integración ERP / n8n..."
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="min-w-[180px] flex-1 rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
                />
                <button
                  type="submit"
                  disabled={isSubmittingKey}
                  className="inline-flex min-h-[40px] items-center gap-1 rounded-xl bg-brand-gradient px-4 py-2 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{isSubmittingKey ? 'Generando...' : 'Generar Key'}</span>
                </button>
              </form>
            </div>
          ) : null}

          <div className="soft-card flex flex-col justify-between p-5">
            <div>
              <div className="flex items-center gap-2 text-sm font-extrabold text-soft-ink">
                <Webhook className="h-4 w-4 text-soft-blue" />
                <span>Webhooks Salientes</span>
              </div>

              <div className="mt-3 flex flex-col gap-2">
                {isLoading ? (
                  <p className="text-xs text-soft-muted">Cargando webhooks...</p>
                ) : webhooks.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-soft-line bg-soft-bg p-4 text-xs text-soft-muted">
                    No hay webhooks salientes registrados.
                  </p>
                ) : (
                  webhooks.map((wh) => (
                    <div
                      key={wh.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-soft-line bg-soft-bg p-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <strong className="truncate text-soft-ink">{wh.name}</strong>
                          <span className="shrink-0 font-mono text-[10px] text-soft-blue">
                            {wh.maskedSecret}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-[11px] text-soft-muted">
                          {wh.targetUrl}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteWebhook(wh.id, wh.name)}
                        aria-label={`Eliminar webhook ${wh.name}`}
                        className="min-h-[40px] min-w-[40px] grid place-items-center rounded-lg p-1.5 text-soft-danger hover:bg-soft-danger/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
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
                    minLength={2}
                    maxLength={80}
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
                    minLength={8}
                    placeholder="Mínimo 8 caracteres"
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
                  placeholder="https://crm.miempresa.com/webhooks/bothub"
                  value={whUrl}
                  onChange={(e) => setWhUrl(e.target.value)}
                  className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-xs text-soft-ink"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmittingWebhook}
                className="mt-1 min-h-[42px] rounded-xl bg-brand-gradient py-2 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
              >
                {isSubmittingWebhook ? 'Registrando...' : '+ Registrar Webhook Saliente'}
              </button>
            </form>
          </div>
        </section>
      ) : (
        <section className="soft-card p-5 text-xs text-soft-muted">
          Las llaves de API y los webhooks salientes solo están disponibles para roles <strong>ADMIN</strong> y <strong>OPERATOR</strong>.
        </section>
      )}
    </div>
  );
}
