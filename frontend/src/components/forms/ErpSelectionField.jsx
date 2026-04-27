/*
 * File-ID: FW-P1-1.3
 * File-Path: frontend/src/components/forms/ErpSelectionField.jsx
 * Gate: FAST-WORK
 * Phase: 1
 * Domain: FRONT
 * Purpose: Compact label-input selection field primitive for ERP scope screens
 * Authority: Frontend
 */

import ErpComboboxField from "./ErpComboboxField.jsx";

function renderField({ type, value, onChange, options, inputRef }) {
  if (type === "select") {
    return (
      <ErpComboboxField
        inputRef={inputRef}
        value={value ?? ""}
        onChange={(val) => onChange?.(val)}
        options={options ?? []}
      />
    );
  }

  return (
    <input
      ref={inputRef}
      type={type}
      value={value ?? ""}
      onChange={(event) => onChange?.(event.target.value)}
      className="h-7 border border-slate-400 bg-white px-2 py-0.5 text-sm text-slate-900 outline-none focus:border-sky-500"
    />
  );
}

export default function ErpSelectionField({
  label,
  value,
  onChange,
  toValue,
  onToChange,
  type = "text",
  options = [],
  inputRef,
}) {
  const hasRange = typeof onToChange === "function" || typeof toValue !== "undefined";

  return (
    <div
      className={`items-center gap-x-1 py-0.5 ${
        hasRange
          ? "grid grid-cols-[180px_200px_40px_200px]"
          : "grid grid-cols-[180px_1fr]"
      }`}
    >
      <label className="text-[11px] font-medium text-slate-700">{label}</label>
      {renderField({ type, value, onChange, options, inputRef })}
      {hasRange ? (
        <>
          <span className="text-center text-[10px] text-slate-500">to</span>
          {renderField({
            type,
            value: toValue,
            onChange: onToChange,
            options,
          })}
        </>
      ) : null}
    </div>
  );
}
