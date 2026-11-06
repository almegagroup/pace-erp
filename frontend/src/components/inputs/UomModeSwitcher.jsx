/*
 * File-Path: frontend/src/components/inputs/UomModeSwitcher.jsx
 * Purpose: Row of unit buttons for stock reports (see shared/uomDisplay.js).
 * Authority: Frontend
 */

export default function UomModeSwitcher({ modes, value, onChange }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span className="font-semibold uppercase tracking-[0.08em]">Unit</span>
      {modes.map((mode) => (
        <button
          key={mode.key}
          type="button"
          onClick={() => onChange(mode.key)}
          title={mode.hint}
          className={`border px-3 py-1 font-semibold uppercase tracking-[0.06em] ${value === mode.key ? "border-sky-700 bg-sky-100 text-sky-950" : "border-slate-300 bg-white text-slate-700"}`}
        >
          {mode.label}
        </button>
      ))}
      <span className="text-slate-400">Materials without the chosen unit stay in their default unit (see the UOM column).</span>
    </div>
  );
}
