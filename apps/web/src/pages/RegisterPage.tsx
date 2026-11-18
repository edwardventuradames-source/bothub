import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Building2, Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { authApi, ApiRequestError } from '../lib/api.js';
import { useAuthStore } from '../store/auth.store.js';
import { useThemeStore } from '../store/theme.store.js';

export function RegisterPage() {
  const navigate = useNavigate();
  const { setSession } = useAuthStore();
  const { resolvedTheme, toggleLightDark } = useThemeStore();

  const [name, setName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const session = await authApi.register({
        name: name.trim(),
        organizationName: organizationName.trim(),
        email: email.trim().toLowerCase(),
        password
      });
      setSession(session);
      navigate('/');
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage(
          'No se pudo conectar con la API para registrar tu usuario.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col justify-center bg-soft-bg p-4 sm:p-8">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between pb-6">
        <div className="flex items-center gap-2.5 text-base font-bold text-soft-ink">
          <i className="grid h-9 w-9 place-items-center rounded-xl bg-brand-gradient text-white not-italic shadow-brand-icon">
            🤖
          </i>
          <span>BotHub · Registro Inicial</span>
        </div>

        <button
          type="button"
          onClick={toggleLightDark}
          className="rounded-xl border border-soft-line bg-soft-card px-3.5 py-2 text-xs font-bold text-soft-ink shadow-soft transition-transform hover:-translate-y-0.5"
        >
          {resolvedTheme === 'dark' ? '☀️ Modo claro' : '🌙 Modo oscuro'}
        </button>
      </div>

      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 overflow-hidden rounded-[20px] bg-soft-card shadow-soft lg:grid-cols-[1.05fr_1fr]">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45 }}
          className="flex flex-col justify-center p-7 sm:p-10"
        >
          <span className="text-xs font-bold uppercase tracking-wider text-soft-blue">
            Configuración desde cero
          </span>
          <h1 className="mt-1 text-2xl font-extrabold text-soft-ink">
            Crea tu cuenta de Administrador
          </h1>
          <p className="mt-1.5 text-sm text-soft-muted">
            Registra tu usuario y tu organización para empezar a crear bots y flujos reales sin datos de demostración.
          </p>

          {errorMessage ? (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="mt-4 rounded-xl border border-soft-danger/30 bg-soft-danger/10 px-4 py-3 text-xs font-semibold text-soft-danger"
            >
              {errorMessage}
            </motion.div>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3.5">
            <div>
              <label
                htmlFor="reg-name"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Nombre completo *
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft-muted" />
                <input
                  id="reg-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tu nombre y apellido"
                  className="w-full rounded-xl border border-soft-line bg-soft-bg py-2.5 pl-10 pr-4 text-sm text-soft-ink placeholder:text-soft-muted focus:border-soft-blue focus:bg-soft-card focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="reg-org"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Nombre de tu Empresa / Organización *
              </label>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft-muted" />
                <input
                  id="reg-org"
                  name="organizationName"
                  type="text"
                  autoComplete="organization"
                  required
                  minLength={2}
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="Nombre de tu empresa"
                  className="w-full rounded-xl border border-soft-line bg-soft-bg py-2.5 pl-10 pr-4 text-sm text-soft-ink placeholder:text-soft-muted focus:border-soft-blue focus:bg-soft-card focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="reg-email"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Correo electrónico *
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft-muted" />
                <input
                  id="reg-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@empresa.com"
                  className="w-full rounded-xl border border-soft-line bg-soft-bg py-2.5 pl-10 pr-4 text-sm text-soft-ink placeholder:text-soft-muted focus:border-soft-blue focus:bg-soft-card focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="reg-password"
                className="mb-1 block text-xs font-bold text-soft-ink"
              >
                Contraseña (mínimo 8 caracteres) *
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft-muted" />
                <input
                  id="reg-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full rounded-xl border border-soft-line bg-soft-bg py-2.5 pl-10 pr-11 text-sm text-soft-ink placeholder:text-soft-muted focus:border-soft-blue focus:bg-soft-card focus:outline-none"
                />
                <button
                  type="button"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={
                    showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-soft-muted hover:text-soft-ink"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.01, y: -1 }}
              whileTap={{ scale: 0.99 }}
              type="submit"
              disabled={isSubmitting}
              className="mt-2 w-full rounded-xl bg-brand-gradient py-3 text-xs font-bold uppercase tracking-wider text-white shadow-brand-icon transition-opacity disabled:opacity-60"
            >
              {isSubmitting ? 'Creando cuenta…' : 'Crear Cuenta e Ingresar'}
            </motion.button>
          </form>

          <div className="mt-5 border-t border-soft-line pt-4 text-center text-xs text-soft-muted">
            ¿Ya tienes una cuenta?{' '}
            <Link to="/login" className="font-bold text-soft-blue hover:underline">
              Iniciar sesión
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative hidden flex-col justify-between overflow-hidden bg-brand-gradient p-10 text-white lg:flex"
        >
          <div className="relative z-10">
            <span className="inline-block rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wider backdrop-blur-xs">
              Entorno Limpio 100% Real
            </span>
            <h2 className="mt-4 text-2xl font-extrabold leading-snug">
              Tu propia instancia multi-tenant desde cero
            </h2>
            <p className="mt-2 text-sm text-white/85 leading-relaxed">
              Contraseña protegida con bcrypt (12 rondas), tokens firmados con JWT y credenciales de WhatsApp/Chatwoot cifradas con AES-256-GCM.
            </p>
          </div>

          <div className="relative z-10 my-6 grid place-items-center">
            <div className="float-bot-3d text-[92px]">🛡️</div>
          </div>

          <div className="relative z-10 rounded-2xl bg-black/20 p-4 backdrop-blur-xs">
            <div className="flex items-center gap-2 text-xs font-bold">
              <span className="dot-online h-2.5 w-2.5 rounded-full bg-[#82d616]" />
              <span>Rol ADMIN Asignado Automáticamente</span>
            </div>
            <p className="mt-1 text-xs text-white/80">
              Luego podrás invitar operadores y auditores desde la sección Usuarios RBAC.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
