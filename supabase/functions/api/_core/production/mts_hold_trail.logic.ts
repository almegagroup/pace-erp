/*
 * File-Path: supabase/functions/api/_core/production/mts_hold_trail.logic.ts
 * Purpose: IN15 "MTS FG Hold & Block Trail" -- pure row/summary logic (no DB), unit-tested.
 *          HOLD events come from MTS Verify's hold rows; STATUS CHANGE events come from IN13 postings on aggregate
 *          MTS SKU stock (no batch -- IN13 rejects a batch there, which also keeps them apart from the status rows
 *          MTS Verify itself writes, which carry the batch and would otherwise show twice).
 * Authority: Backend
 */

export type HeldStockType = "QUALITY_INSPECTION" | "BLOCKED";
const HELD_TYPES: string[] = ["QUALITY_INSPECTION", "BLOCKED"];

export type HoldRow = {
  id: string;
  company_id: string;
  process_order_id: string;
  process_order_number: string | null;
  process_order_status: string | null;
  packing_order_number: string | null;
  material_id: string;
  batch_number: string;
  batch_number_from: string;
  batch_number_to: string;
  target_stock_type: string;
  declared_pack_qty: number;
  held_pack_qty: number;
  qty_kg: number;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type SscRow = {
  id: string;
  document_number: string;
  company_id: string;
  material_id: string;
  storage_location_id: string | null;
  batch_number: string | null;
  packing_po_number: string | null;
  from_stock_type: string;
  to_stock_type: string;
  quantity: number;
  uom_code: string | null;
  reason: string | null;
  status: string;
  requires_approval: boolean;
  reversal_of_posting_id: string | null;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
};

export type TrailEvent = {
  key: string;
  event_type: "HOLD" | "STATUS_CHANGE";
  event_at: string;
  company_id: string;
  material_id: string;
  process_order_number: string | null;
  packing_order_number: string | null;
  batch_number: string | null;
  from_stock_type: string;
  to_stock_type: string;
  bags: number | null;
  qty_kg: number;
  by_user_id: string | null;
  approved_by_user_id: string | null;
  reason: string | null;
  reason_display: string;
  document_number: string | null;
  state: string;
};

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const STATE_BY_STATUS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  POSTED: "Posted",
  REVERSED: "Reversed",
};

const touchesHeldStock = (row: SscRow): boolean =>
  HELD_TYPES.includes(row.from_stock_type) || HELD_TYPES.includes(row.to_stock_type);

export function buildTrailEvents(holds: HoldRow[], sscRows: SscRow[]): TrailEvent[] {
  const events: TrailEvent[] = [];

  for (const row of holds) {
    events.push({
      key: `HOLD:${row.id}`,
      event_type: "HOLD",
      event_at: row.created_at,
      company_id: row.company_id,
      material_id: row.material_id,
      process_order_number: row.process_order_number,
      packing_order_number: row.packing_order_number,
      batch_number: row.batch_number,
      from_stock_type: "UNRESTRICTED",
      to_stock_type: row.target_stock_type,
      bags: num(row.held_pack_qty),
      qty_kg: num(row.qty_kg),
      by_user_id: row.created_by,
      approved_by_user_id: null,
      reason: row.reason,
      reason_display: row.reason ?? "—",
      document_number: null,
      state: String(row.process_order_status ?? "").toUpperCase() === "REVERSED" ? "Reversed with Process PO" : "Active",
    });
  }

  for (const row of sscRows) {
    if (row.batch_number != null && row.batch_number !== "") continue; // written by MTS Verify -> already shown as a HOLD
    if (row.packing_po_number != null && row.packing_po_number !== "") continue; // a specific-Packing-PO FG row, not aggregate MTS stock
    if (!touchesHeldStock(row)) continue;
    events.push({
      key: `SSC:${row.id}`,
      event_type: "STATUS_CHANGE",
      event_at: row.created_at,
      company_id: row.company_id,
      material_id: row.material_id,
      process_order_number: null,
      packing_order_number: null,
      batch_number: null,
      from_stock_type: row.from_stock_type,
      to_stock_type: row.to_stock_type,
      bags: null,
      qty_kg: num(row.quantity),
      by_user_id: row.created_by,
      approved_by_user_id: row.approved_by,
      reason: row.reason,
      reason_display: row.reason ?? "—",
      document_number: row.document_number,
      state: row.reversal_of_posting_id ? "Reversal" : (STATE_BY_STATUS[row.status] ?? row.status),
    });
  }

  return events.sort((left, right) => Date.parse(right.event_at) - Date.parse(left.event_at));
}

// No status chosen = everything; otherwise keep the events that move stock into or out of a chosen status.
export function filterEventsByStatus(events: TrailEvent[], statuses: string[]): TrailEvent[] {
  if (statuses.length === 0) return events;
  return events.filter((event) => statuses.includes(event.from_stock_type) || statuses.includes(event.to_stock_type));
}

// Net kg currently in QI / Blocked per company + SKU, from posted status changes only. A reversed posting and the row that
// reverses it are BOTH left out, so a reversal never counts twice. SKU level (per company) -- releases carry no batch.
export function computeHeldSummary(sscRows: SscRow[]): Array<{ company_id: string; material_id: string; qi_kg: number; blocked_kg: number }> {
  const bySku = new Map<string, { company_id: string; material_id: string; qi_kg: number; blocked_kg: number }>();
  for (const row of sscRows) {
    if (row.status !== "POSTED" || row.reversal_of_posting_id) continue;
    if (!touchesHeldStock(row)) continue;
    const key = `${row.company_id}|${row.material_id}`;
    const entry = bySku.get(key) ?? { company_id: row.company_id, material_id: row.material_id, qi_kg: 0, blocked_kg: 0 };
    const qty = num(row.quantity);
    if (row.to_stock_type === "QUALITY_INSPECTION") entry.qi_kg += qty;
    if (row.from_stock_type === "QUALITY_INSPECTION") entry.qi_kg -= qty;
    if (row.to_stock_type === "BLOCKED") entry.blocked_kg += qty;
    if (row.from_stock_type === "BLOCKED") entry.blocked_kg -= qty;
    bySku.set(key, entry);
  }
  return [...bySku.values()].map((entry) => ({
    company_id: entry.company_id,
    material_id: entry.material_id,
    qi_kg: Number(entry.qi_kg.toFixed(6)),
    blocked_kg: Number(entry.blocked_kg.toFixed(6)),
  }));
}
