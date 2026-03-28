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
    <label className={`block ${className}`.trim()}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
        {label}
      </span>
      <input
        ref={inputRef}
        data-workspace-primary-focus={primaryFocus ? "true" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:bg-black/30"
        {...inputProps}
      />
      {hint ? (
        <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
          {hint}
        </p>
      ) : null}
    </label>
  );
}
