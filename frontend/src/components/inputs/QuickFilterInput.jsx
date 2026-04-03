/*
 * File-ID: 9.15-FRONT
 * File-Path: frontend/src/components/inputs/QuickFilterInput.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Provide the dense keyboard-native quick filter input used across ERP list and report surfaces
 * Authority: Frontend
 */

export default function QuickFilterInput({
  label = "Quick Filter",
  value,
  onChange,
  placeholder,
  hint,
  inputRef,
  primaryFocus = false,
  className = "",
  inputProps = {},
}) {
  return (
    <label className={`block border border-slate-300 bg-slate-50 ${className}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {label}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Filter
        </span>
      </div>
      <input
        ref={inputRef}
        data-workspace-primary-focus={primaryFocus ? "true" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full border-0 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-[#f8fbff]"
        {...inputProps}
      />
      {hint ? (
        <p className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
          {hint}
        </p>
      ) : null}
    </label>
  );
}
