import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Plus, Shield, UserCheck } from 'lucide-react';
import { OrganizationUserDto, UserRole } from '@bothub/shared';
import { platformApi } from '../lib/api.js';

export function UsersRbacPage() {
  const dialogTitleId = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const [users, setUsers] = useState<OrganizationUserDto[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('OPERATOR');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadUsers(): Promise<void> {
      const res = await platformApi.listUsers();
      setUsers(res.users);
    }
    void loadUsers();
  }, []);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
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
    dialogRef.current?.close();
    setStatusMsg(`Usuario "${user.name}" creado con rol ${user.role}.`);
  }

  async function handleRoleChange(userId: string, nextRole: UserRole): Promise<void> {
    const { user } = await platformApi.updateUser(userId, { role: nextRole });
    setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
    setStatusMsg(`Rol de ${user.name} actualizado a ${user.role}.`);
  }

  async function handleToggleActive(
    userId: string,
    currentActive: boolean
  ): Promise<void> {
    const { user } = await platformApi.updateUser(userId, {
      isActive: !currentActive
    });
    setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
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
            Usuarios de la Organización ({users.length})
          </h1>
          <p className="mt-0.5 text-xs text-soft-muted">
            Administra cuentas con contraseñas protegidas con bcrypt y permisos diferenciados (ADMIN, OPERATOR, VIEWER).
          </p>
        </div>

        <button
          type="button"
          onClick={() => dialogRef.current?.showModal()}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-4 py-2.5 text-xs font-extrabold text-white shadow-brand-icon"
        >
          <Plus className="h-4 w-4" />
          <span>Nuevo Usuario</span>
        </button>
      </section>

      {statusMsg ? (
        <div
          role="status"
          className="rounded-2xl border border-[#82d616]/40 bg-[#82d616]/15 px-4 py-2.5 text-xs font-bold text-soft-ink"
        >
          {statusMsg}
        </div>
      ) : null}

      <section className="soft-card overflow-hidden p-5">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-soft-line text-[11px] font-extrabold uppercase text-soft-muted">
                <th className="py-2.5">Nombre</th>
                <th className="py-2.5">Correo Electrónico</th>
                <th className="py-2.5">Rol RBAC</th>
                <th className="py-2.5">Estado</th>
                <th className="py-2.5">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-soft-line text-xs">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-3.5 font-extrabold text-soft-ink">{u.name}</td>
                  <td className="py-3.5 text-soft-muted">{u.email}</td>
                  <td className="py-3.5">
                    <label htmlFor={`role-${u.id}`} className="sr-only">
                      Rol de {u.name}
                    </label>
                    <select
                      id={`role-${u.id}`}
                      value={u.role}
                      onChange={(e) =>
                        void handleRoleChange(u.id, e.target.value as UserRole)
                      }
                      className="rounded-lg border border-soft-line bg-soft-bg px-2.5 py-1 text-xs font-bold text-soft-ink"
                    >
                      <option value="ADMIN">ADMIN (Total)</option>
                      <option value="OPERATOR">OPERATOR (Bots y Flujos)</option>
                      <option value="VIEWER">VIEWER (Solo Lectura)</option>
                    </select>
                  </td>
                  <td className="py-3.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${
                        u.isActive
                          ? 'bg-[#82d616]/15 text-[#4b830d]'
                          : 'bg-soft-danger/15 text-soft-danger'
                      }`}
                    >
                      <UserCheck className="h-3 w-3" />
                      {u.isActive ? 'ACTIVO' : 'SUSPENDIDO'}
                    </span>
                  </td>
                  <td className="py-3.5">
                    <button
                      type="button"
                      onClick={() => void handleToggleActive(u.id, u.isActive)}
                      className="rounded-lg border border-soft-line bg-soft-bg px-3 py-1 text-xs font-bold text-soft-ink hover:border-soft-blue"
                    >
                      {u.isActive ? 'Suspender' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
              className="rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-bold text-soft-ink"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-xl bg-brand-gradient px-5 py-2 text-xs font-extrabold text-white shadow-brand-icon"
            >
              Crear Usuario
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
