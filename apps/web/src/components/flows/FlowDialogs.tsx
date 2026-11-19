import { FormEvent, RefObject, useId } from 'react';
import { BotDto } from '@bothub/shared';

interface CreateFlowDialogProps {
  dialogRef: RefObject<HTMLDialogElement>;
  name: string;
  description: string;
  botId: string;
  bots: BotDto[];
  isSaving: boolean;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onBotIdChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function CreateFlowDialog({
  dialogRef,
  name,
  description,
  botId,
  bots,
  isSaving,
  onNameChange,
  onDescriptionChange,
  onBotIdChange,
  onSubmit
}: CreateFlowDialogProps) {
  const titleId = useId();

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-full max-w-md rounded-2xl border border-soft-line bg-soft-card p-6 text-soft-ink shadow-soft"
    >
      <h2 id={titleId} className="text-lg font-extrabold text-soft-ink">
        Crear Nuevo Flujo Visual
      </h2>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
        <div>
          <label
            htmlFor="create-flow-name"
            className="mb-1 block text-xs font-bold text-soft-ink"
          >
            Nombre del Flujo *
          </label>
          <input
            id="create-flow-name"
            type="text"
            required
            autoFocus
            placeholder="Ej: Calificación de Leads Inmobiliarios"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
          />
        </div>

        <div>
          <label
            htmlFor="create-flow-bot"
            className="mb-1 block text-xs font-bold text-soft-ink"
          >
            Asignar a Bot (Opcional)
          </label>
          <select
            id="create-flow-bot"
            value={botId}
            onChange={(e) => onBotIdChange(e.target.value)}
            className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
          >
            <option value="">Sin asignar aún</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.phoneNumber || b.driver})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="create-flow-desc"
            className="mb-1 block text-xs font-bold text-soft-ink"
          >
            Descripción
          </label>
          <textarea
            id="create-flow-desc"
            rows={2}
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            className="w-full rounded-xl border border-soft-line bg-soft-bg px-3.5 py-2 text-xs text-soft-ink"
          />
        </div>

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
            disabled={isSaving}
            className="min-h-[40px] rounded-xl bg-brand-gradient px-5 py-2 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
          >
            {isSaving ? 'Creando...' : 'Crear Flujo'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

interface DeleteFlowDialogProps {
  dialogRef: RefObject<HTMLDialogElement>;
  flowName: string;
  isSaving: boolean;
  onConfirm: () => void;
}

export function DeleteFlowDialog({
  dialogRef,
  flowName,
  isSaving,
  onConfirm
}: DeleteFlowDialogProps) {
  const titleId = useId();

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-full max-w-md rounded-2xl border border-soft-line bg-soft-card p-6 text-soft-ink shadow-soft"
    >
      <h2 id={titleId} className="text-base font-extrabold text-soft-ink">
        Eliminar Flujo Conversacional
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-soft-muted">
        ¿Confirmas eliminar el flujo{' '}
        <strong className="text-soft-ink">{flowName}</strong>? Se desvinculará de cualquier bot que lo tenga asignado.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="min-h-[40px] rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-bold text-soft-ink"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={onConfirm}
          className="min-h-[40px] rounded-xl bg-soft-danger px-4 py-2 text-xs font-extrabold text-white disabled:opacity-60"
        >
          {isSaving ? 'Eliminando...' : 'Eliminar Flujo'}
        </button>
      </div>
    </dialog>
  );
}
