import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  GitBranch,
  History,
  Plus,
  Rocket,
  Save,
  Trash2
} from 'lucide-react';
import { FlowDto } from '@bothub/shared';

interface FlowEditorHeaderProps {
  flows: FlowDto[];
  activeFlow: FlowDto | null;
  canEditFlows: boolean;
  isSaving: boolean;
  onSelectFlow: (flowId: string) => void;
  onOpenCreateDialog: () => void;
  onRestoreVersion: (versionId: string) => void;
  onRequestDeleteFlow: (flow: FlowDto) => void;
  onSaveDraft: () => void;
  onPublishVersion: () => void;
}

export function FlowEditorHeader({
  flows,
  activeFlow,
  canEditFlows,
  isSaving,
  onSelectFlow,
  onOpenCreateDialog,
  onRestoreVersion,
  onRequestDeleteFlow,
  onSaveDraft,
  onPublishVersion
}: FlowEditorHeaderProps) {
  return (
    <section className="soft-card flex flex-wrap items-center justify-between gap-4 p-5">
      <h1 className="sr-only">Editor Visual de Flujos</h1>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-gradient text-white shadow-brand-icon">
          <GitBranch className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/flows"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-xs font-extrabold text-soft-ink hover:border-soft-blue"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Flujos</span>
            </Link>

            <label htmlFor="flow-selector" className="sr-only">
              Seleccionar Flujo
            </label>
            <select
              id="flow-selector"
              value={activeFlow?.id ?? ''}
              disabled={flows.length === 0}
              onChange={(e) => onSelectFlow(e.target.value)}
              className="min-h-[40px] max-w-full rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-sm font-extrabold text-soft-ink"
            >
              {flows.length === 0 ? (
                <option value="">Sin flujos disponibles</option>
              ) : (
                flows.map((flow) => (
                  <option key={flow.id} value={flow.id}>
                    {flow.name} (v{flow.activeVersionNumber})
                  </option>
                ))
              )}
            </select>

            {canEditFlows ? (
              <button
                type="button"
                onClick={onOpenCreateDialog}
                className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-soft-line bg-soft-bg px-3 py-1.5 text-xs font-extrabold text-soft-ink hover:border-soft-blue"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Nuevo Flujo</span>
              </button>
            ) : null}

            {activeFlow?.versions && activeFlow.versions.length > 0 ? (
              <div className="inline-flex min-h-[40px] max-w-full items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-2.5 py-1">
                <History className="h-3.5 w-3.5 shrink-0 text-soft-blue" />
                <label htmlFor="flow-version-selector" className="sr-only">
                  Restaurar versión anterior
                </label>
                <select
                  id="flow-version-selector"
                  disabled={isSaving || !canEditFlows}
                  value={activeFlow.draftVersion.id}
                  onChange={(e) => onRestoreVersion(e.target.value)}
                  className="max-w-[200px] truncate bg-transparent text-xs font-bold text-soft-ink focus:outline-none sm:max-w-none"
                >
                  {activeFlow.versions.map((ver) => (
                    <option key={ver.id} value={ver.id}>
                      v{ver.versionNumber} ·{' '}
                      {ver.status === 'PUBLISHED' ? 'Publicada' : 'Borrador'} (
                      {new Date(ver.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                      )
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {canEditFlows && activeFlow ? (
              <button
                type="button"
                onClick={() => onRequestDeleteFlow(activeFlow)}
                aria-label={`Eliminar flujo ${activeFlow.name}`}
                title="Eliminar flujo actual"
                className="grid min-h-[40px] min-w-[40px] place-items-center rounded-xl border border-soft-line bg-soft-bg text-soft-danger hover:border-soft-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-soft-muted">
            {activeFlow?.description ??
              'Selecciona un flujo del listado o crea uno nuevo para editar sus nodos.'}
          </p>
        </div>
      </div>

      {canEditFlows && activeFlow ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={isSaving}
            onClick={onSaveDraft}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-soft-line bg-soft-bg px-4 py-2 text-xs font-extrabold text-soft-ink hover:border-soft-blue disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5 text-soft-blue" />
            <span>Guardar Borrador</span>
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={onPublishVersion}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-brand-gradient px-4 py-2 text-xs font-extrabold text-white shadow-brand-icon disabled:opacity-60"
          >
            <Rocket className="h-3.5 w-3.5" />
            <span>
              Publicar Versión v{(activeFlow?.activeVersionNumber ?? 1) + 1}
            </span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
