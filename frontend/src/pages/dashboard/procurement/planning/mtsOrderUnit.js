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
