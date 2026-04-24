/*
 * File-ID: FW-P1-1.5
 * File-Path: frontend/src/components/data/ErpRegisterHeader.jsx
 * Gate: FAST-WORK
 * Phase: 1
 * Domain: FRONT
 * Purpose: Compact ERP register header with inline count and filter
 * Authority: Frontend
 */

export default function ErpRegisterHeader({
  title,
  count,
  filterValue = "",
  onFilterChange,
  filterRef,
  filterPlaceholder = "Quick filter",
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 border-b border-slate-300 pb-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {typeof count === "number" ? (
          <span className="ml-2 text-[11px] text-slate-500">{count} rows</span>
        ) : null}
      </div>
      {typeof onFilterChange === "function" ? (
        <input
          ref={filterRef}
          type="text"
          value={filterValue}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder={filterPlaceholder}
          className="h-7 w-full max-w-[240px] border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-sky-500"
        />
      ) : null}
    </div>
  );
}
