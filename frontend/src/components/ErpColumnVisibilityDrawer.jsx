import DrawerBase from "./layer/DrawerBase.jsx";

export default function ErpColumnVisibilityDrawer({
  visible,
  title = "Choose Visible Columns",
  columns = [],
  visibleColumnKeys = [],
  onToggleColumn,
  onResetColumns,
  onClose,
}) {
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
