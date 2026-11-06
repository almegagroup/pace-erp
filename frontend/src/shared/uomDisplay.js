/*
 * File-Path: frontend/src/shared/uomDisplay.js
 * Purpose: Shared unit-of-measure switch for stock reports (IN03 Current Stock, IN14 Stock History).
 *          The backend returns every quantity in BASE units plus, per row, `uom_options`
 *          ([{ kind: BASE|OUTER|INNER|PO, uom_code, factor }]) and `default_uom_code`; this converts
 *          in the browser so changing the unit needs no new request.
 * Authority: Frontend
 */

export const UOM_MODES = [
  { key: "DEFAULT", label: "Default", hint: "FG (MTS): outer / PM: PO UoM / else base" },
  { key: "BASE", label: "Base", hint: "Base unit of measure" },
  { key: "OUTER", label: "Outer", hint: "FG outer pack" },
  { key: "INNER", label: "Inner", hint: "FG inner (primary container) unit" },
  { key: "PO", label: "PO UoM", hint: "Purchase / PO unit (RM, PM, INT)" },
];

// Only offer a mode when at least one row in the result can actually use it.
export function availableUomModes(rows) {
  const kinds = new Set();
  for (const row of rows) for (const option of row.uom_options ?? []) kinds.add(option.kind);
  return UOM_MODES.filter((mode) => mode.key === "DEFAULT" || kinds.has(mode.key));
}

function pickOption(row, mode) {
  const options = Array.isArray(row.uom_options) ? row.uom_options : [];
  const byDefault = options.find((entry) => entry.uom_code === row.default_uom_code) ?? null;
  if (mode === "DEFAULT") return byDefault ?? options.find((entry) => entry.kind === "BASE") ?? null;
  return options.find((entry) => entry.kind === mode) ?? byDefault ?? options.find((entry) => entry.kind === "BASE") ?? null;
}

// Rows without the chosen unit fall back to their default unit (shown in the UOM column).
// `qtyFields` are flat numeric fields; `mapFields` are objects of numeric fields (e.g. buckets).
export function applyUomMode(row, mode, { qtyFields = [], mapFields = [] } = {}) {
  const option = pickOption(row, mode);
  const factor = option && Number(option.factor) > 0 ? Number(option.factor) : 1;
  const uom_code = option?.uom_code ?? row.uom_code;
  if (factor === 1) return { ...row, uom_code };
  const scale = (value) => Math.round((Number(value ?? 0) / factor) * 1e6) / 1e6;
  const next = { ...row, uom_code };
  for (const field of qtyFields) if (field in row) next[field] = scale(row[field]);
  for (const field of mapFields) {
    if (row[field]) next[field] = Object.fromEntries(Object.entries(row[field]).map(([key, value]) => [key, scale(value)]));
  }
  return next;
}
