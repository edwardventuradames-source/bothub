import { FormEvent, useEffect, useState } from 'react';
import { Contact, Plus, Sparkles, Tag, Users } from 'lucide-react';
import { ContactDto } from '@bothub/shared';
import { platformApi } from '../lib/api.js';

export function ContactsPage() {
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [newVarKey, setNewVarKey] = useState('');
  const [newVarValue, setNewVarValue] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const selectedContact =
    contacts.find((c) => c.id === selectedContactId) ?? contacts[0] ?? null;

  useEffect(() => {
    async function loadContacts(): Promise<void> {
      const res = await platformApi.listContacts();
      setContacts(res.contacts);
      if (res.contacts[0]) {
        setSelectedContactId(res.contacts[0].id);
      }
    }
    void loadContacts();
  }, []);

  async function handleAddVariable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedContact || !newVarKey.trim() || !newVarValue.trim()) return;
    const cleanKey = newVarKey.trim().replace(/[^a-zA-Z0-9_]/g, '_');
    const { contact } = await platformApi.updateContact(selectedContact.id, {
      variables: {
        ...selectedContact.variables,
        [cleanKey]: newVarValue.trim()
      }
    });
    setContacts((prev) => prev.map((c) => (c.id === contact.id ? contact : c)));
    setNewVarKey('');
    setNewVarValue('');
    setFeedback(`Variable {{${cleanKey}}} actualizada para ${contact.name}.`);
  }

  async function handleAddTag(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedContact || !newTagInput.trim()) return;
    const nextTags = Array.from(
      new Set([...selectedContact.tags, newTagInput.trim().toLowerCase()])
    );
    const { contact } = await platformApi.updateContact(selectedContact.id, {
      tags: nextTags
    });
    setContacts((prev) => prev.map((c) => (c.id === contact.id ? contact : c)));
    setNewTagInput('');
    setFeedback(`Etiqueta agregada y sincronizada con Chatwoot.`);
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
            Contactos Sincronizados ({contacts.length})
          </h1>
          <p className="mt-0.5 text-xs text-soft-muted">
            Consulta y edita las variables recolectadas por los nodos de pregunta (`cedula`, `nombre`, `telefono`) y etiquetas de Chatwoot.
          </p>
        </div>
      </section>

      {feedback ? (
        <div
          role="status"
          className="rounded-2xl border border-[#82d616]/40 bg-[#82d616]/15 px-4 py-2.5 text-xs font-bold text-soft-ink"
        >
          {feedback}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="soft-card overflow-hidden p-5">
          <h2 className="mb-3 text-sm font-extrabold text-soft-ink">
            Listado de Contactos WhatsApp
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-soft-line text-[11px] font-extrabold uppercase text-soft-muted">
                  <th className="py-2.5">Contacto</th>
                  <th className="py-2.5">Teléfono</th>
                  <th className="py-2.5">Cédula / Doc</th>
                  <th className="py-2.5">Chatwoot ID</th>
                  <th className="py-2.5">Etiquetas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-soft-line text-xs">
                {contacts.map((contact) => {
                  const isSelected = selectedContact?.id === contact.id;
                  return (
                    <tr
                      key={contact.id}
                      onClick={() => setSelectedContactId(contact.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-soft-blue/10' : 'hover:bg-soft-bg'
                      }`}
                    >
                      <td className="py-3 font-extrabold text-soft-ink">
                        {contact.name}
                      </td>
                      <td className="py-3 text-soft-muted">{contact.phoneNumber}</td>
                      <td className="py-3 font-mono font-bold text-soft-ink">
                        {contact.nationalId ?? '—'}
                      </td>
                      <td className="py-3 text-soft-blue">
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
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-gradient text-white shadow-brand-icon">
                <Contact className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-soft-ink">
                  {selectedContact.name}
                </h2>
                <p className="text-xs text-soft-muted">
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
                    <div className="mt-0.5 font-bold text-soft-ink">{val}</div>
                  </div>
                ))}
              </div>

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
                    className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
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
                    className="w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1 rounded-xl bg-brand-gradient px-3.5 py-2 text-xs font-extrabold text-white shadow-brand-icon"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Guardar</span>
                </button>
              </form>
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
                    className="rounded-full bg-[#82d616]/15 px-3 py-1 text-xs font-extrabold text-[#4b830d]"
                  >
                    #{tag}
                  </span>
                ))}
              </div>

              <form onSubmit={handleAddTag} className="mt-3 flex gap-2">
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
                  className="flex-1 rounded-xl border border-soft-line bg-soft-bg px-3 py-2 text-xs text-soft-ink"
                />
                <button
                  type="submit"
                  className="rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-extrabold text-soft-ink hover:border-soft-blue"
                >
                  + Etiqueta
                </button>
              </form>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
