/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/mtsOrderUnit.js
 * Purpose: PO22 Order UoM (owner 2026-10-22) — show a buy quantity in base unit and in the unit
 *          it is ordered in ("1,200 BTL = 300 PKT"). The conversion comes from the backend
 *          (vendor MM03 Supply UoM, else Material Settings Order UoM); never guessed here.
 */

function fmt(value) {
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

/** qtyBase in base unit; unit = { order_uom_code, base_per_order_unit } from the backend, or null. */
export function qtyWithOrderUnit(qtyBase, uom, unit) {
  if (qtyBase === null || qtyBase === undefined || qtyBase === "") return "—";
  const base = `${fmt(qtyBase)} ${uom ?? ""}`.trim();
  if (!unit || !(Number(unit.base_per_order_unit) > 0)) return base;
  return `${base} = ${fmt(Number(qtyBase) / Number(unit.base_per_order_unit))} ${unit.order_uom_code}`;
}

/** Rows that already carry order_qty / order_uom (Item Plan). */
export function orderQtyText(orderQty, orderUom) {
  return orderUom && orderQty !== null && orderQty !== undefined ? `${fmt(orderQty)} ${orderUom}` : "";
}

/**
 * Owner 2026-10-26: every PO22 quantity is shown only in the material's display unit — Material
 * Settings Order UoM, else the vendor's MM03 Supply UoM, else its base UoM. `displayUnits` comes
 * from the backend (material_id → { uom_code, base_per_unit }); calculations stay in base UoM.
 */
export function makeDisplayUnits(displayUnits) {
  const units = displayUnits ?? {};
  const unitOf = (materialId) => (materialId ? units[materialId] ?? null : null);
  const convert = (qtyBase, unit) => {
    if (qtyBase === null || qtyBase === undefined || qtyBase === "") return qtyBase;
    const n = Number(qtyBase);
    if (!Number.isFinite(n) || !unit || !(Number(unit.base_per_unit) > 0)) return qtyBase;
    return Math.round((n / Number(unit.base_per_unit)) * 1000) / 1000;
  };
  /** A group shows one unit only when every member shows the same unit and factor; else base. */
  const groupUnit = (memberIds) => {
    const list = (memberIds ?? []).map(unitOf);
    if (list.length === 0 || list.some((u) => !u)) return null;
    const [first] = list;
    return list.every((u) => u.uom_code === first.uom_code && Number(u.base_per_unit) === Number(first.base_per_unit)) ? first : null;
  };
  return {
    unitOf,
    groupUnit,
    /** Quantity of a material in its display unit (number; null/blank passes through). */
    qty: (qtyBase, materialId) => convert(qtyBase, unitOf(materialId)),
    /** Quantity in a given unit (null = base). */
    qtyIn: convert,
    /** Unit label of a material. */
    uom: (materialId, baseUom) => unitOf(materialId)?.uom_code ?? baseUom ?? "",
  };
}

/**
 * One quantity text in a single unit (owner 2026-10-26 "only Order UoM"): the lot's own order unit
 * when the backend gave one (vendor of that lot), else the material's display unit, else base UoM.
 */
export function qtyInDisplayUnit(qtyBase, baseUom, unit) {
  if (qtyBase === null || qtyBase === undefined || qtyBase === "") return "—";
  const n = Number(qtyBase);
  if (!Number.isFinite(n)) return "—";
  if (unit && Number(unit.base_per_order_unit ?? unit.base_per_unit) > 0) {
    const factor = Number(unit.base_per_order_unit ?? unit.base_per_unit);
    return `${fmt(n / factor)} ${unit.order_uom_code ?? unit.uom_code}`;
  }
  return `${fmt(n)} ${baseUom ?? ""}`.trim();
}
