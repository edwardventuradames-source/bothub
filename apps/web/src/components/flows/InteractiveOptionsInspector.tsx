import { Edge, Node } from '@xyflow/react';
import { Plus, Trash2 } from 'lucide-react';

export interface ButtonOption {
  id: string;
  label: string;
}

export interface ListOption {
  id: string;
  title: string;
  description?: string;
}

interface InteractiveOptionsInspectorProps {
  selectedNode: Node;
  nodeType: 'BUTTONS' | 'LIST' | 'CONDITION';
  allNodes: Node[];
  edges: Edge[];
  onUpdateData: (key: string, value: unknown) => void;
  onSetBranchEdge: (
    sourceNodeId: string,
    sourceHandle: string,
    targetNodeId: string,
    label?: string
  ) => void;
}

export function InteractiveOptionsInspector({
  selectedNode,
  nodeType,
  allNodes,
  edges,
  onUpdateData,
  onSetBranchEdge
}: InteractiveOptionsInspectorProps) {
  const destinationOptions = allNodes.filter((n) => n.id !== selectedNode.id);

  const getConnectedTargetId = (handleId: string): string => {
    const edge = edges.find(
      (e) => e.source === selectedNode.id && e.sourceHandle === handleId
    );
    return edge?.target ?? '';
  };

  if (nodeType === 'CONDITION') {
    const trueTarget = getConnectedTargetId('true');
    const falseTarget = getConnectedTargetId('false');

    return (
      <div className="flex flex-col gap-2.5 rounded-xl border border-soft-line bg-soft-bg p-3">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
          Rutas de Condición
        </span>
        <div>
          <label
            htmlFor="cond-true-target"
            className="mb-1 block text-[11px] font-bold text-soft-ink"
          >
            Si es VERDADERO (true) ir a:
          </label>
          <select
            id="cond-true-target"
            value={trueTarget}
            onChange={(e) =>
              onSetBranchEdge(selectedNode.id, 'true', e.target.value, 'Verdadero')
            }
            className="w-full rounded-xl border border-soft-line bg-soft-card px-2.5 py-1.5 text-xs text-soft-ink"
          >
            <option value="">-- Sin conectar --</option>
            {destinationOptions.map((node) => (
              <option key={node.id} value={node.id}>
                {String(node.data.label ?? node.id)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="cond-false-target"
            className="mb-1 block text-[11px] font-bold text-soft-ink"
          >
            Si es FALSO (false) ir a:
          </label>
          <select
            id="cond-false-target"
            value={falseTarget}
            onChange={(e) =>
              onSetBranchEdge(selectedNode.id, 'false', e.target.value, 'Falso')
            }
            className="w-full rounded-xl border border-soft-line bg-soft-card px-2.5 py-1.5 text-xs text-soft-ink"
          >
            <option value="">-- Sin conectar --</option>
            {destinationOptions.map((node) => (
              <option key={node.id} value={node.id}>
                {String(node.data.label ?? node.id)}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  if (nodeType === 'BUTTONS') {
    const buttons: ButtonOption[] = Array.isArray(selectedNode.data.buttons)
      ? (selectedNode.data.buttons as ButtonOption[])
      : [];

    const handleButtonLabelChange = (index: number, nextLabel: string) => {
      const updated = buttons.map((btn, idx) =>
        idx === index ? { ...btn, label: nextLabel } : btn
      );
      onUpdateData('buttons', updated);
      const target = getConnectedTargetId(buttons[index].id);
      if (target) {
        onSetBranchEdge(selectedNode.id, buttons[index].id, target, nextLabel);
      }
    };

    const handleAddButton = () => {
      if (buttons.length >= 3) return;
      const nextIndex = buttons.length + 1;
      const newBtn: ButtonOption = {
        id: `btn-${Date.now().toString().slice(-4)}-${nextIndex}`,
        label: `${nextIndex}. Opción ${nextIndex}`
      };
      onUpdateData('buttons', [...buttons, newBtn]);
    };

    const handleRemoveButton = (btnId: string) => {
      if (buttons.length <= 1) return;
      onUpdateData(
        'buttons',
        buttons.filter((b) => b.id !== btnId)
      );
      onSetBranchEdge(selectedNode.id, btnId, '');
    };

    return (
      <div className="flex flex-col gap-2.5 rounded-xl border border-soft-line bg-soft-bg p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
            Botones ({buttons.length}/3 · Máx 20 chars)
          </span>
          {buttons.length < 3 ? (
            <button
              type="button"
              onClick={handleAddButton}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-gradient px-2 py-1 text-[10px] font-extrabold text-white"
            >
              <Plus className="h-3 w-3" />
              <span>Agregar</span>
            </button>
          ) : null}
        </div>

        <div className="flex flex-col gap-2.5">
          {buttons.map((btn, idx) => {
            const targetId = getConnectedTargetId(btn.id);
            const charCount = btn.label.trim().length;
            return (
              <div
                key={btn.id}
                className="flex flex-col gap-1.5 rounded-xl border border-soft-line bg-soft-card p-2.5"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <label
                    htmlFor={`btn-label-${btn.id}`}
                    className="text-[10px] font-bold text-soft-muted"
                  >
                    Botón #{idx + 1} ({charCount}/20)
                  </label>
                  {buttons.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => handleRemoveButton(btn.id)}
                      aria-label={`Eliminar botón ${idx + 1}`}
                      title="Eliminar botón"
                      className="grid min-h-[32px] min-w-[32px] place-items-center rounded p-1 text-soft-danger hover:bg-soft-danger/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                <input
                  id={`btn-label-${btn.id}`}
                  type="text"
                  maxLength={24}
                  value={btn.label}
                  onChange={(e) => handleButtonLabelChange(idx, e.target.value)}
                  className="w-full rounded-lg border border-soft-line bg-soft-bg px-2.5 py-1.5 text-xs font-bold text-soft-ink"
                />
                {charCount > 20 ? (
                  <span className="text-[10px] font-semibold text-soft-warning">
                    WhatsApp Cloud API recorta títulos mayores a 20 caracteres.
                  </span>
                ) : null}
                <div>
                  <label
                    htmlFor={`btn-target-${btn.id}`}
                    className="mb-0.5 block text-[10px] font-bold text-soft-muted"
                  >
                    Al seleccionar ir a:
                  </label>
                  <select
                    id={`btn-target-${btn.id}`}
                    value={targetId}
                    onChange={(e) =>
                      onSetBranchEdge(
                        selectedNode.id,
                        btn.id,
                        e.target.value,
                        btn.label
                      )
                    }
                    className="w-full rounded-lg border border-soft-line bg-soft-bg px-2 py-1 text-[11px] text-soft-ink"
                  >
                    <option value="">-- Sin conectar --</option>
                    {destinationOptions.map((node) => (
                      <option key={node.id} value={node.id}>
                        {String(node.data.label ?? node.id)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const listItems: ListOption[] = Array.isArray(selectedNode.data.items)
    ? (selectedNode.data.items as ListOption[])
    : [];

  const handleListItemChange = (
    index: number,
    field: 'title' | 'description',
    value: string
  ) => {
    const updated = listItems.map((item, idx) =>
      idx === index ? { ...item, [field]: value } : item
    );
    onUpdateData('items', updated);
    if (field === 'title') {
      const target = getConnectedTargetId(listItems[index].id);
      if (target) {
        onSetBranchEdge(selectedNode.id, listItems[index].id, target, value);
      }
    }
  };

  const handleAddListItem = () => {
    if (listItems.length >= 10) return;
    const nextIndex = listItems.length + 1;
    const newItem: ListOption = {
      id: `item-${Date.now().toString().slice(-4)}-${nextIndex}`,
      title: `${nextIndex}. Opción ${nextIndex}`,
      description: 'Descripción breve'
    };
    onUpdateData('items', [...listItems, newItem]);
  };

  const handleRemoveListItem = (itemId: string) => {
    if (listItems.length <= 1) return;
    onUpdateData(
      'items',
      listItems.filter((i) => i.id !== itemId)
    );
    onSetBranchEdge(selectedNode.id, itemId, '');
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-soft-line bg-soft-bg p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-soft-blue">
          Opciones de Lista ({listItems.length}/10)
        </span>
        {listItems.length < 10 ? (
          <button
            type="button"
            onClick={handleAddListItem}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-gradient px-2 py-1 text-[10px] font-extrabold text-white"
          >
            <Plus className="h-3 w-3" />
            <span>Agregar</span>
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2.5">
        {listItems.map((item, idx) => {
          const targetId = getConnectedTargetId(item.id);
          return (
            <div
              key={item.id}
              className="flex flex-col gap-1.5 rounded-xl border border-soft-line bg-soft-card p-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-soft-muted">
                  Opción #{idx + 1}
                </span>
                {listItems.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => handleRemoveListItem(item.id)}
                    aria-label={`Eliminar opción ${idx + 1}`}
                    title="Eliminar opción"
                    className="grid min-h-[32px] min-w-[32px] place-items-center rounded p-1 text-soft-danger hover:bg-soft-danger/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <input
                type="text"
                aria-label={`Título de la opción ${idx + 1}`}
                maxLength={24}
                value={item.title}
                onChange={(e) => handleListItemChange(idx, 'title', e.target.value)}
                placeholder="Título (máx 24 chars)"
                className="w-full rounded-lg border border-soft-line bg-soft-bg px-2.5 py-1 text-xs font-bold text-soft-ink"
              />
              <input
                type="text"
                aria-label={`Descripción de la opción ${idx + 1}`}
                maxLength={72}
                value={item.description ?? ''}
                onChange={(e) =>
                  handleListItemChange(idx, 'description', e.target.value)
                }
                placeholder="Descripción opcional"
                className="w-full rounded-lg border border-soft-line bg-soft-bg px-2.5 py-1 text-[11px] text-soft-ink"
              />
              <select
                aria-label={`Nodo destino para la opción ${idx + 1}`}
                value={targetId}
                onChange={(e) =>
                  onSetBranchEdge(
                    selectedNode.id,
                    item.id,
                    e.target.value,
                    item.title
                  )
                }
                className="w-full rounded-lg border border-soft-line bg-soft-bg px-2 py-1 text-[11px] text-soft-ink"
              >
                <option value="">-- Sin conectar --</option>
                {destinationOptions.map((node) => (
                  <option key={node.id} value={node.id}>
                    {String(node.data.label ?? node.id)}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
