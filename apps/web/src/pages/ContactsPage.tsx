import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Contact, Plus, Sparkles, Tag, Users } from 'lucide-react';
import { ContactDto } from '@bothub/shared';
import { platformApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.store.js';

export function ContactsPage() {
  const outletContext = useOutletContext<{ searchQuery?: string } | null>();
  const searchQuery = outletContext?.searchQuery ?? '';
  const user = useAuthStore((s) => s.user);
  const canEditContacts = user?.role === 'ADMIN' || user?.role === 'OPERATOR';

  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [newVarKey, setNewVarKey] = useState('');
  const [newVarValue, setNewVarValue] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const filteredContacts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.phoneNumber.toLowerCase().includes(query) ||
        (c.nationalId ?? '').toLowerCase().includes(query) ||
        c.tags.some((t) => t.toLowerCase().includes(query))
    );
  }, [contacts, searchQuery]);

  const selectedContact =
    filteredContacts.find((c) => c.id === selectedContactId) ??
    filteredContacts[0] ??
    null;

  useEffect(() => {
    async function loadContacts(): Promise<void> {
      setIsLoading(true);
      try {
        const res = await platformApi.listContacts();
        setContacts(res.contacts);
        if (res.contacts[0]) {
          setSelectedContactId(res.contacts[0].id);
        }
      } catch (err) {
        setFeedback({
          type: 'err',
          text:
            err instanceof Error
              ? err.message
              : 'No se pudo cargar el directorio de contactos.'
        });
      } finally {
        setIsLoading(false);
      }
    }
    void loadContacts();
  }, []);

  async function handleAddVariable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      !canEditContacts ||
      !selectedContact ||
      !newVarKey.trim() ||
      !newVarValue.trim() ||
      isSubmitting
    ) {
      return;
    }
    const cleanKey = newVarKey.trim().replace(/[^a-zA-Z0-9_]/g, '_');
    setIsSubmitting(true);
    try {
      const { contact } = await platformApi.updateContact(selectedContact.id, {
        variables: {
          ...selectedContact.variables,
          [cleanKey]: newVarValue.trim()
        }
      });
      setContacts((prev) => prev.map((c) => (c.id === contact.id ? contact : c)));
      setNewVarKey('');
      setNewVarValue('');
      setFeedback({
        type: 'ok',
        text: `Variable {{${cleanKey}}} actualizada para ${contact.name}.`
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo actualizar la variable del contacto.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAddTag(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canEditContacts || !selectedContact || !newTagInput.trim() || isSubmitting) {
      return;
    }
    const nextTags = Array.from(
      new Set([...selectedContact.tags, newTagInput.trim().toLowerCase()])
    );
    setIsSubmitting(true);
    try {
      const { contact } = await platformApi.updateContact(selectedContact.id, {
        tags: nextTags
      });
      setContacts((prev) => prev.map((c) => (c.id === contact.id ? contact : c)));
      setNewTagInput('');
      setFeedback({
        type: 'ok',
        text: 'Etiqueta agregada y sincronizada con Chatwoot.'
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text:
          err instanceof Error ? err.message : 'No se pudo agregar la etiqueta.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="soft-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-soft-blue/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
            <Users className="h-3.5 w-3.5" />
            <span>Directorio CRM & Variables de Sesión</span>
          </span>
          <h1 className="mt-1.5 text-xl font-extrabold text-soft-ink">
            Contactos Sincronizados ({filteredContacts.length})
          </h1>
          <p className="mt-0.5 text-xs text-soft-muted">
            Consulta y edita las variables recolectadas por los nodos de pregunta (cédula, nombre, teléfono) y etiquetas de Chatwoot.
          </p>
        </div>
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

      {!isLoading && filteredContacts.length === 0 ? (
        <div className="soft-card flex flex-col items-center justify-center gap-2 p-10 text-center">
          <Users className="h-8 w-8 text-soft-blue" />
          <h2 className="text-base font-extrabold text-soft-ink">
            {contacts.length === 0
              ? 'Aún no hay contactos registrados'
              : 'Sin contactos para tu búsqueda'}
          </h2>
          <p className="max-w-md text-xs text-soft-muted">
            Los contactos se crean automáticamente cuando los usuarios escriben por WhatsApp o desde Chatwoot.
          </p>
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div className="soft-card overflow-hidden p-5">
            <h2 className="mb-3 text-sm font-extrabold text-soft-ink">
              Listado de Contactos WhatsApp
            </h2>

            <div className="flex flex-col gap-2.5 md:hidden">
              {filteredContacts.map((contact) => {
                const isSelected = selectedContact?.id === contact.id;
                return (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => setSelectedContactId(contact.id)}
                    className={`flex flex-col gap-1.5 rounded-2xl border p-3.5 text-left transition-colors ${
                      isSelected
                        ? 'border-soft-blue bg-soft-blue/10'
                        : 'border-soft-line bg-soft-bg'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-soft-ink">
                        {contact.name}
                      </span>
                      <span className="text-[11px] font-bold text-soft-blue">
                        #{contact.chatwootContactId ?? 'N/A'}
                      </span>
                    </div>
                    <span className="text-xs text-soft-muted">
                      {contact.phoneNumber} · Doc: {contact.nationalId ?? '—'}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {contact.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-md bg-soft-card px-2 py-0.5 text-[10px] font-bold text-soft-ink"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-soft-line text-[11px] font-extrabold uppercase text-soft-muted">
                    <th className="py-2.5 pr-3">Contacto</th>
                    <th className="py-2.5 pr-3">Teléfono</th>
                    <th className="py-2.5 pr-3">Cédula / Doc</th>
                    <th className="py-2.5 pr-3">Chatwoot ID</th>
                    <th className="py-2.5">Etiquetas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-soft-line text-xs">
                  {filteredContacts.map((contact) => {
                    const isSelected = selectedContact?.id === contact.id;
                    return (
                      <tr
                        key={contact.id}
                        className={`transition-colors ${
                          isSelected ? 'bg-soft-blue/10' : 'hover:bg-soft-bg'
                        }`}
                      >
                        <td className="py-3 pr-3 font-extrabold text-soft-ink">
                          <button
                            type="button"
                            onClick={() => setSelectedContactId(contact.id)}
                            className="text-left font-extrabold text-soft-ink hover:text-soft-blue hover:underline"
                          >
                            {contact.name}
                          </button>
                        </td>
                        <td className="py-3 pr-3 text-soft-muted">{contact.phoneNumber}</td>
                        <td className="py-3 pr-3 font-mono font-bold text-soft-ink">
                          {contact.nationalId ?? '—'}
                        </td>
                        <td className="py-3 pr-3 text-soft-blue">
                          #{contact.chatwootContactId ?? 'N/A'}
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1">
                            {contact.tags.map((t) => (
                              <span
                                key={t}
                                className="rounded-md bg-soft-bg px-2 py-0.5 text-[10px] font-bold text-soft-ink"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selectedContact ? (
            <div className="soft-card flex flex-col gap-5 p-5">
              <div className="flex items-center gap-3 border-b border-soft-line pb-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-gradient text-white shadow-brand-icon">
                  <Contact className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-extrabold text-soft-ink">
                    {selectedContact.name}
                  </h2>
                  <p className="truncate text-xs text-soft-muted">
                    {selectedContact.phoneNumber} · {selectedContact.email ?? 'Sin correo'}
                  </p>
                </div>
              </div>

              <div>
                <span className="inline-flex items-center gap-1 text-xs font-extrabold uppercase tracking-wider text-soft-blue">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Variables Dinámicas del Contacto</span>
                </span>

                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {Object.entries(selectedContact.variables).map(([key, val]) => (
                    <div
                      key={key}
                      className="rounded-xl border border-soft-line bg-soft-bg p-2.5 text-xs"
                    >
                      <div className="font-mono text-[11px] font-extrabold text-soft-blue">
                        {`{{${key}}}`}
                      </div>
                      <div className="mt-0.5 break-words font-bold text-soft-ink">{val}</div>
                    </div>
                  ))}
                </div>

                {canEditContacts ? (
                  <form
                    onSubmit={handleAddVariable}
                    className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
                  >
                    <div>
                      <label htmlFor="var-key" className="sr-only">
                        Nombre de variable
                      </label>
                      <input
                        id="var-key"
                        type="text"
                        required
                        placeholder="Variable (ej: ciudad)"
                        value={newVarKey}
                        onChange={(e) => setNewVarKey(e.target.value)}
                        className="min-h-[38px] w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                      />
                    </div>
                    <div>
                      <label htmlFor="var-val" className="sr-only">
                        Valor de variable
                      </label>
                      <input
                        id="var-val"
                        type="text"
                        required
                        placeholder="Valor (ej: Medellín)"
                        value={newVarValue}
                        onChange={(e) => setNewVarValue(e.target.value)}
                        className="min-h-[38px] w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="inline-flex min-h-[38px] items-center justify-center gap-1 rounded-xl bg-brand-gradient px-3.5 py-2 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Guardar</span>
                    </button>
                  </form>
                ) : null}
              </div>

              <div className="border-t border-soft-line pt-4">
                <span className="inline-flex items-center gap-1 text-xs font-extrabold uppercase tracking-wider text-soft-blue">
                  <Tag className="h-3.5 w-3.5" />
                  <span>Etiquetas en Chatwoot</span>
                </span>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedContact.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-[#82d616]/15 px-3 py-1 text-xs font-extrabold text-[#4b830d] dark:text-[#82d616]"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>

                {canEditContacts ? (
                  <form onSubmit={handleAddTag} className="mt-3 flex flex-wrap gap-2">
                    <label htmlFor="new-tag-input" className="sr-only">
                      Nueva etiqueta
                    </label>
                    <input
                      id="new-tag-input"
                      type="text"
                      required
                      placeholder="Agregar etiqueta (ej: vip-2026)..."
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      className="min-h-[38px] min-w-0 flex-1 rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                    />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="min-h-[38px] shrink-0 rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-extrabold text-soft-ink hover:border-soft-blue disabled:opacity-60"
                    >
                      + Etiqueta
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
