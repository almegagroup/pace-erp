/*
 * File-ID: 9.6A-FRONT
 * File-Path: frontend/src/components/inputs/ErpCompactFilterSelect.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Compact dropdown selector for dense pre-list filters
 * Authority: Frontend
 */

export default function ErpCompactFilterSelect({
  label = "Filter",
  value,
  options,
  onChange,
  selectRef = null,
  primaryFocus = false,
  helperText = "",
  extra = null,
}) {
  const activeOption =
    options.find((option) => option.key === value) ?? options[0] ?? null;

  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-[240px] flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {label}
          </span>
          {activeOption ? (
            <span className="inline-flex border border-sky-300 bg-sky-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-900">
              {activeOption.label}
            </span>
          ) : null}
        </div>
        <select
          ref={selectRef}
          data-workspace-primary-focus={primaryFocus ? "true" : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-[44px] w-full min-w-[240px] border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-400 focus:bg-white"
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        {helperText ? (
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {helperText}
          </p>
        ) : null}
      </div>
      {extra ? <div className="flex items-center gap-2 pt-7">{extra}</div> : null}
    </div>
  );
}
