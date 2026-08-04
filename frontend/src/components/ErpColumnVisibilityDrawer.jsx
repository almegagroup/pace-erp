import DrawerBase from "./layer/DrawerBase.jsx";

export default function ErpColumnVisibilityDrawer({
  visible,
  title = "Choose Visible Columns",
  columns = [],
  visibleColumnKeys = [],
  layoutOptions = [],
  activeLayoutId = "",
  defaultLayoutId = "",
  onSelectLayout,
  onSaveCurrentAs,
  onSetDefaultLayout,
  onDeleteLayout,
  onToggleColumn,
  onResetColumns,
  onClose,
}) {
  const hasLayoutControls = layoutOptions.length > 0 || typeof onSaveCurrentAs === "function" || typeof onSetDefaultLayout === "function";

  return (
    <DrawerBase
      visible={visible}
      title={title}
      onEscape={onClose}
      width="min(440px, calc(100vw - 24px))"
      actions={
        <>
          <button
            type="button"
            onClick={onResetColumns}
            className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-slate-700"
          >
            Reset Default
          </button>
          <button
            type="button"
            onClick={onClose}
            className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-sky-950"
          >
            Done
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        {hasLayoutControls ? (
          <div className="grid gap-3 border border-slate-200 bg-slate-50 p-3">
            <div className="grid gap-1">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                Saved Layouts
              </div>
              <select
                value={activeLayoutId}
                onChange={(event) => onSelectLayout?.(event.target.value)}
                className="min-h-10 border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">My Default</option>
                {layoutOptions.map((layout) => (
                  <option key={layout.id} value={layout.id}>
                    {layout.label}
                    {layout.id === defaultLayoutId ? " (Default)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap gap-2">
              {typeof onSaveCurrentAs === "function" ? (
                <button
                  type="button"
                  onClick={onSaveCurrentAs}
                  className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-700"
                >
                  Save Current As...
                </button>
              ) : null}
              {typeof onSetDefaultLayout === "function" ? (
                <button
                  type="button"
                  onClick={onSetDefaultLayout}
                  className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-700"
                >
                  Set As My Default
                </button>
              ) : null}
              {typeof onDeleteLayout === "function" ? (
                <button
                  type="button"
                  onClick={() => onDeleteLayout(activeLayoutId)}
                  disabled={!activeLayoutId}
                  className="border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-rose-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  Delete Layout
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="grid gap-2">
          {columns.map((column) => {
            const checked = visibleColumnKeys.includes(column.key);

            return (
              <label
                key={column.key}
                className="flex items-center justify-between gap-3 border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700"
              >
                <span>{column.label}</span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleColumn?.(column.key)}
                  disabled={checked && visibleColumnKeys.length === 1}
                />
              </label>
            );
          })}
        </div>
      </div>
    </DrawerBase>
  );
}
