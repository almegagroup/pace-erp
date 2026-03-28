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
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </span>
      <input
        ref={inputRef}
        data-workspace-primary-focus={primaryFocus ? "true" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:bg-white"
        {...inputProps}
      />
      {hint ? (
        <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
          {hint}
        </p>
      ) : null}
    </label>
  );
}
