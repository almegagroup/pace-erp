/*
 * File-Path: frontend/src/components/forms/UomQuantityInput.jsx
 * Purpose: §110 (SAP-Identical Multi-UoM) reusable quantity+UoM entry.
 *          User types a quantity in whichever unit they pick (defaulting to
 *          the material's designated purchase/dispatch unit); this converts
 *          to base UoM via the material's own material_uom_conversion factor
 *          and reports ONLY the base-UoM quantity upward — callers never
 *          need to know which unit the user actually typed in.
 *
 *          Note: pass `key={materialId}` (or the line's own id) when using
 *          this inside a list of rows — that's how its internal unit/value
 *          state resets cleanly when the row's material changes, instead of
 *          syncing it via an effect.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";

// "1 unit of from_uom_code = conversion_factor unit of to_uom_code" — the
// existing system-wide convention (e.g. PKT->BOT factor=4). Only rows that
// convert DIRECTLY to this material's own base UoM are usable here — this
// component is single-hop by design, matching every other UoM conversion in
// the system (no chained Carton->Bottle->KG resolution exists anywhere).
function buildUnitOptions(baseUomCode, conversions) {
  const options = [{ value: baseUomCode, label: baseUomCode, factor: 1 }];
  for (const row of conversions ?? []) {
    if (row.variable_conversion || row.conversion_factor === null || row.conversion_factor === undefined) continue;
    const factor = Number(row.conversion_factor);
    if (!Number.isFinite(factor) || factor <= 0) continue;
    if (row.to_uom_code === baseUomCode && row.from_uom_code !== baseUomCode) {
      options.push({ value: row.from_uom_code, label: row.from_uom_code, factor });
    }
  }
  return options;
}

export default function UomQuantityInput({
  baseUomCode,
  conversions,
  defaultUomCode,
  value,
  onChange,
  disabled = false,
  className = "",
}) {
  const unitOptions = useMemo(() => buildUnitOptions(baseUomCode, conversions), [baseUomCode, conversions]);
  const initialUnit = unitOptions.some((option) => option.value === defaultUomCode) ? defaultUomCode : baseUomCode;
  const [selectedUom, setSelectedUom] = useState(initialUnit);
  // `value` (base-UoM qty, for editing an existing line) is only ever used to
  // seed the very first render — after that the raw text the user types owns
  // the field, so this stays a plain useState initializer, not an effect.
  const [rawValue, setRawValue] = useState(() => {
    if (value === undefined || value === null || value === "") return "";
    const factor = unitOptions.find((option) => option.value === initialUnit)?.factor ?? 1;
    return factor ? String(Number(value) / factor) : String(value);
  });

  const selectedFactor = unitOptions.find((option) => option.value === selectedUom)?.factor ?? 1;

  function emitChange(nextRaw, nextUom) {
    const parsed = Number(nextRaw);
    const factor = unitOptions.find((option) => option.value === nextUom)?.factor ?? 1;
    const baseQty = Number.isFinite(parsed) && parsed > 0 ? parsed * factor : null;
    onChange?.(baseQty, { enteredQty: parsed, enteredUomCode: nextUom });
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <input
        type="number"
        min="0"
        step="any"
        value={rawValue}
        disabled={disabled}
        onChange={(event) => {
          setRawValue(event.target.value);
          emitChange(event.target.value, selectedUom);
        }}
        className="h-8 w-24 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100"
        placeholder="Qty"
      />
      {unitOptions.length > 1 ? (
        <select
          value={selectedUom}
          disabled={disabled}
          onChange={(event) => {
            setSelectedUom(event.target.value);
            emitChange(rawValue, event.target.value);
          }}
          className="h-8 border border-slate-300 bg-white px-1 text-sm text-slate-700 outline-none focus:border-sky-500 disabled:bg-slate-100"
        >
          {unitOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <span className="text-xs text-slate-400">{baseUomCode}</span>
      )}
      {selectedUom !== baseUomCode && rawValue ? (
        <span className="whitespace-nowrap text-xs text-slate-400">
          = {(Number(rawValue) * selectedFactor).toFixed(3)} {baseUomCode}
        </span>
      ) : null}
    </div>
  );
}
