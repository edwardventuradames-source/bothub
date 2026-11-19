import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, KeyRound, Lock, Mail } from 'lucide-react';
import { authApi, ApiRequestError } from '../lib/api.js';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const redirectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  async function handleRequestReset(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    setIsLoading(true);

    try {
      const response = await authApi.forgotPassword({ email });
      setStatusMessage(response.message);
      if (response.devResetToken) {
        setToken(response.devResetToken);
      }
      setStep('reset');
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage(
          'No se pudo conectar con el servidor para solicitar el restablecimiento.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConfirmReset(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const response = await authApi.resetPassword({ token, newPassword });
      setStatusMessage(response.message);
      redirectTimerRef.current = window.setTimeout(() => navigate('/login'), 1500);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('No se pudo verificar el token con el servidor.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-soft-bg p-4">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="soft-card w-full max-w-md p-8"
      >
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-soft-muted hover:text-soft-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Volver al inicio de sesión</span>
        </Link>

        <div className="mt-4 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-gradient text-white shadow-brand-icon">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="m-0 text-lg font-extrabold text-soft-ink">
              Recuperar Contraseña
            </h1>
            <p className="m-0 text-xs text-soft-muted">
              Restablece tu acceso de forma segura
            </p>
          </div>
        </div>

        {statusMessage ? (
          <div className="mt-4 rounded-xl border border-soft-success/30 bg-soft-success/10 p-3 text-xs font-semibold text-soft-ink">
            {statusMessage}
          </div>
        ) : null}

        {errorMessage ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-soft-danger/30 bg-soft-danger/10 p-3 text-xs font-semibold text-soft-danger"
          >
            {errorMessage}
          </div>
        ) : null}

        {step === 'request' ? (
          <form onSubmit={handleRequestReset} className="mt-6 flex flex-col gap-4">
            <div>
              <label
                htmlFor="recovery-email"
                className="mb-1.5 block text-xs font-bold text-soft-ink"
              >
                Correo electrónico de tu cuenta
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft-muted" />
                <input
                  id="recovery-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@bothub.local"
                  className="w-full rounded-xl border border-soft-line bg-soft-bg py-2.5 pl-10 pr-4 text-sm text-soft-ink focus:border-soft-blue focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="min-h-[44px] w-full rounded-xl bg-brand-gradient py-3 text-xs font-bold uppercase tracking-wider text-white shadow-brand-icon disabled:opacity-60"
            >
              {isLoading ? 'Enviando…' : 'Enviar Instrucciones'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleConfirmReset} className="mt-6 flex flex-col gap-4">
            <div>
              <label
                htmlFor="reset-token"
                className="mb-1.5 block text-xs font-bold text-soft-ink"
              >
                Token de recuperación
              </label>
              <input
                id="reset-token"
                name="token"
                type="text"
                required
                minLength={16}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Pega el código recibido"
                className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2.5 text-sm text-soft-ink focus:border-soft-blue focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="new-password"
                className="mb-1.5 block text-xs font-bold text-soft-ink"
              >
                Nueva contraseña
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft-muted" />
                <input
                  id="new-password"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full rounded-xl border border-soft-line bg-soft-bg py-2.5 pl-10 pr-4 text-sm text-soft-ink focus:border-soft-blue focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="min-h-[44px] w-full rounded-xl bg-brand-gradient py-3 text-xs font-bold uppercase tracking-wider text-white shadow-brand-icon disabled:opacity-60"
            >
              {isLoading ? 'Actualizando…' : 'Guardar Nueva Contraseña'}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
