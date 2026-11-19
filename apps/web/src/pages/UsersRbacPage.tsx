import { FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Shield, UserCheck } from 'lucide-react';
import { OrganizationUserDto, UserRole } from '@bothub/shared';
import { platformApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.store.js';

export function UsersRbacPage() {
  const outletContext = useOutletContext<{ searchQuery?: string } | null>();
  const searchQuery = outletContext?.searchQuery ?? '';
  const dialogTitleId = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role === 'ADMIN';

  const [users, setUsers] = useState<OrganizationUserDto[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('OPERATOR');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  useEffect(() => {
    async function loadUsers(): Promise<void> {
      setIsLoading(true);
      try {
        const res = await platformApi.listUsers();
        setUsers(res.users);
      } catch (err) {
        setFeedback({
          type: 'err',
          text:
            err instanceof Error
              ? err.message
              : 'No se pudo cargar la lista de usuarios.'
        });
      } finally {
        setIsLoading(false);
      }
    }
    void loadUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query) ||
        u.role.toLowerCase().includes(query)
    );
  }, [users, searchQuery]);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!isAdmin || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const { user } = await platformApi.createUser({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role
      });
      setUsers((prev) => [...prev, user]);
      setName('');
      setEmail('');
      setPassword('');
      setRole('OPERATOR');
      dialogRef.current?.close();
      setFeedback({
        type: 'ok',
        text: `Usuario "${user.name}" creado con rol ${user.role}.`
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo crear el usuario.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRoleChange(userId: string, nextRole: UserRole): Promise<void> {
    if (!isAdmin || busyUserId) return;
    setBusyUserId(userId);
    try {
      const { user } = await platformApi.updateUser(userId, { role: nextRole });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
      setFeedback({
        type: 'ok',
        text: `Rol de ${user.name} actualizado a ${user.role}.`
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo actualizar el rol del usuario.'
      });
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleToggleActive(
    userId: string,
    currentActive: boolean
  ): Promise<void> {
    if (!isAdmin || busyUserId) return;
    setBusyUserId(userId);
    try {
      const { user } = await platformApi.updateUser(userId, {
        isActive: !currentActive
      });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
      setFeedback({
        type: 'ok',
        text: user.isActive
          ? `Cuenta ${user.name} activada.`
          : `Cuenta ${user.name} suspendida.`
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo actualizar el estado del usuario.'
      });
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="soft-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-soft-blue/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
            <Shield className="h-3.5 w-3.5" />
            <span>Control de Acceso Basado en Roles (RBAC)</span>
          </span>
          <h1 className="mt-1.5 text-xl font-extrabold text-soft-ink">
            Usuarios de la Organización ({filteredUsers.length})
          </h1>
          <p className="mt-0.5 text-xs text-soft-muted">
            Administra cuentas con contraseñas protegidas con bcrypt y permisos diferenciados (ADMIN, OPERATOR, VIEWER).
          </p>
        </div>

        {isAdmin ? (
          <button
            type="button"
            onClick={() => dialogRef.current?.showModal()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-gradient px-4 py-2.5 text-xs font-extrabold text-white shadow-brand-icon"
          >
            <Plus className="h-4 w-4" />
            <span>Nuevo Usuario</span>
          </button>
        ) : null}
      </section>

      {feedback ? (
        <div
          role={feedback.type === 'err' ? 'alert' : 'status'}
          className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 text-xs font-bold ${
            feedback.type === 'ok'
              ? 'border-[#82d616]/40 bg-[#82d616]/15 text-soft-ink'
              : 'border-soft-danger/40 bg-soft-danger/15 text-soft-danger'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="underline"
          >
            Cerrar
          </button>
        </div>
      ) : null}

      <section className="soft-card overflow-hidden p-5">
        {!isLoading && filteredUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Shield className="h-7 w-7 text-soft-blue" />
            <p className="m-0 text-xs font-bold text-soft-ink">
              {users.length === 0
                ? 'No hay usuarios registrados en la organización.'
                : 'Ningún usuario coincide con tu búsqueda.'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 md:hidden">
              {filteredUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex flex-col gap-3 rounded-2xl border border-soft-line bg-soft-bg p-4 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm font-extrabold text-soft-ink">
                        {u.name}
                      </strong>
                      <span className="block truncate text-soft-muted">{u.email}</span>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${
                        u.isActive
                          ? 'bg-[#82d616]/15 text-[#4b830d] dark:text-[#82d616]'
                          : 'bg-soft-danger/15 text-soft-danger'
                      }`}
                    >
                      <UserCheck className="h-3 w-3" />
                      {u.isActive ? 'ACTIVO' : 'SUSPENDIDO'}
                    </span>
                  </div>

                  {isAdmin ? (
                    <div className="flex flex-wrap items-center gap-2 border-t border-soft-line pt-2.5">
                      <label htmlFor={`mobile-role-${u.id}`} className="sr-only">
                        Rol de {u.name}
                      </label>
                      <select
                        id={`mobile-role-${u.id}`}
                        disabled={busyUserId === u.id}
                        value={u.role}
                        onChange={(e) =>
                          void handleRoleChange(u.id, e.target.value as UserRole)
                        }
                        className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-soft-line bg-soft-card px-2.5 py-1 text-xs font-bold text-soft-ink"
                      >
                        <option value="ADMIN">ADMIN (Total)</option>
                        <option value="OPERATOR">OPERATOR (Bots y Flujos)</option>
                        <option value="VIEWER">VIEWER (Solo Lectura)</option>
                      </select>
                      <button
                        type="button"
                        disabled={busyUserId === u.id}
                        onClick={() => void handleToggleActive(u.id, u.isActive)}
                        className="min-h-[40px] shrink-0 rounded-lg border border-soft-line bg-soft-card px-3 py-1 text-xs font-bold text-soft-ink hover:border-soft-blue disabled:opacity-50"
                      >
                        {u.isActive ? 'Suspender' : 'Activar'}
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] font-bold text-soft-blue">
                      Rol: {u.role}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-soft-line text-[11px] font-extrabold uppercase text-soft-muted">
                    <th className="py-2.5 pr-3">Nombre</th>
                    <th className="py-2.5 pr-3">Correo Electrónico</th>
                    <th className="py-2.5 pr-3">Rol RBAC</th>
                    <th className="py-2.5 pr-3">Estado</th>
                    {isAdmin ? <th className="py-2.5">Acciones</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-soft-line text-xs">
                  {filteredUsers.map((u) => (
                    <tr key={u.id}>
                      <td className="py-3.5 pr-3 font-extrabold text-soft-ink">{u.name}</td>
                      <td className="py-3.5 pr-3 text-soft-muted">{u.email}</td>
                      <td className="py-3.5 pr-3">
                        {isAdmin ? (
                          <>
                            <label htmlFor={`role-${u.id}`} className="sr-only">
                              Rol de {u.name}
                            </label>
                            <select
                              id={`role-${u.id}`}
                              disabled={busyUserId === u.id}
                              value={u.role}
                              onChange={(e) =>
                                void handleRoleChange(u.id, e.target.value as UserRole)
                              }
                              className="rounded-lg border border-soft-line bg-soft-bg px-2.5 py-1 text-xs font-bold text-soft-ink disabled:opacity-50"
                            >
                              <option value="ADMIN">ADMIN (Total)</option>
                              <option value="OPERATOR">OPERATOR (Bots y Flujos)</option>
                              <option value="VIEWER">VIEWER (Solo Lectura)</option>
                            </select>
                          </>
                        ) : (
                          <span className="rounded-md bg-soft-bg px-2.5 py-1 text-xs font-bold text-soft-ink">
                            {u.role}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 pr-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${
                            u.isActive
                              ? 'bg-[#82d616]/15 text-[#4b830d] dark:text-[#82d616]'
                              : 'bg-soft-danger/15 text-soft-danger'
                          }`}
                        >
                          <UserCheck className="h-3 w-3" />
                          {u.isActive ? 'ACTIVO' : 'SUSPENDIDO'}
                        </span>
                      </td>
                      {isAdmin ? (
                        <td className="py-3.5">
                          <button
                            type="button"
                            disabled={busyUserId === u.id}
                            onClick={() => void handleToggleActive(u.id, u.isActive)}
                            className="min-h-[36px] rounded-lg border border-soft-line bg-soft-bg px-3 py-1 text-xs font-bold text-soft-ink hover:border-soft-blue disabled:opacity-50"
                          >
                            {u.isActive ? 'Suspender' : 'Activar'}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <dialog
        ref={dialogRef}
        aria-labelledby={dialogTitleId}
        className="w-full max-w-md rounded-2xl border border-soft-line bg-soft-card p-6 text-soft-ink shadow-soft"
      >
        <h2 id={dialogTitleId} className="text-lg font-extrabold text-soft-ink">
          Registrar Nuevo Usuario
        </h2>
        <form onSubmit={handleCreateUser} className="mt-4 flex flex-col gap-3">
          <div>
            <label
              htmlFor="u-name"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Nombre Completo *
            </label>
            <input
              id="u-name"
              name="name"
              type="text"
              autoComplete="name"
              required
              minLength={2}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
            />
          </div>

          <div>
            <label
              htmlFor="u-email"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Correo Corporativo *
            </label>
            <input
              id="u-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
            />
          </div>

          <div>
            <label
              htmlFor="u-pass"
              className="mb-1 block text-xs font-bold text-soft-ink"
            >
              Contraseña Inicial (mínimo 8 caracteres) *
            </label>
            <input
              id="u-pass"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
            />
          </div>

          <fieldset className="rounded-xl border border-soft-line bg-soft-bg p-3">
            <legend className="px-1 text-xs font-bold text-soft-ink">
              Rol de Acceso (RBAC)
            </legend>
            <div className="mt-1 flex flex-col gap-1.5">
              {(['ADMIN', 'OPERATOR', 'VIEWER'] as UserRole[]).map((r) => (
                <div key={r} className="flex items-center gap-2">
                  <input
                    id={`new-role-${r}`}
                    type="radio"
                    name="role"
                    value={r}
                    checked={role === r}
                    onChange={() => setRole(r)}
                  />
                  <label
                    htmlFor={`new-role-${r}`}
                    className="text-xs font-bold text-soft-ink"
                  >
                    {r}
                  </label>
                </div>
              ))}
            </div>
          </fieldset>

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="min-h-[40px] rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-bold text-soft-ink"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-[40px] rounded-xl bg-brand-gradient px-5 py-2 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
            >
              {isSubmitting ? 'Creando...' : 'Crear Usuario'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
