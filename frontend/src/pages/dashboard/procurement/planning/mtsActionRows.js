/*
 * PO22 Action tab (owner 2026-10-19: Critical + Replenishment in one simple list).
 * Pure: derives "what to do, by when, why" rows from the Planning payload. Never changes a number.
 */
const DAY_MS = 86_400_000;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export const ACTION_LEVELS = {
  URGENT: { rank: 1, label: "Urgent" },
  SOON: { rank: 2, label: "This week" },
  PLAN: { rank: 3, label: "Planned" },
  FIX_DATA: { rank: 4, label: "Fix data" },
};

/** One row per thing a person must do, most urgent first. */
export function buildActionRows(plan) {
  if (!plan) return [];
  const asOf = plan.calendar.as_of;
  const riskOf = new Map((plan.risks ?? []).map((r) => [r.material_id, r]));
  // Owner 2026-10-27: Bulk RM (and groups made only of Bulk RM) stay out of PO22 for now.
  const bulkMaterials = new Set(plan.bulk_material_ids ?? []);
  const bulkGroups = new Set(plan.bulk_group_ids ?? []);
  const rows = [];
  const push = (row) => {
    if ((row.material_id && bulkMaterials.has(row.material_id)) || (row.group_id && bulkGroups.has(row.group_id))) return;
    rows.push({ id: `${row.kind}|${row.material_id ?? row.group_id ?? ""}|${rows.length}`, ...row });
  };

  for (const buy of plan.buys ?? []) {
    const risk = riskOf.get(buy.material_id);
    const shortage = risk?.first_shortage_day ?? null;
    const critical = risk?.first_below_critical_day ?? null;
    const base = { material_id: buy.material_id, material: buy.material_name, code: buy.material_code, uom: buy.uom, order_unit: buy.order_unit ?? null, shortage_day: shortage, critical_day: critical };
    if (buy.status === "ADVISORY_LATE" && buy.sequence === 1) {
      push({ ...base, kind: "BUY", level: "URGENT", action: "Order today", by_when: asOf, qty: buy.recommended_po_qty_base, vendor: buy.vendor_label,
        why: `Should have been ordered by ${buy.need_date ? addDays(buy.need_date, -(buy.total_lead_time_days ?? 0)) : "earlier"}; ordering today arrives ${buy.estimated_plant_eta}.${shortage ? ` Stock runs out ${shortage}.` : ""}` });
    } else if (buy.status === "ADVISORY") {
      const left = daysBetween(asOf, buy.recommended_po_by);
      push({ ...base, kind: "BUY", level: left <= 7 ? "SOON" : "PLAN", action: buy.sequence > 1 ? `Order (next order #${buy.sequence})` : "Order", by_when: buy.recommended_po_by,
        qty: buy.recommended_po_qty_base, vendor: buy.vendor_label,
        why: `Cover falls to Target on ${buy.need_date}; arrives ${buy.estimated_plant_eta} if ordered by ${buy.recommended_po_by}.` });
    } else if (buy.status === "UNKNOWN_POLICY") {
      if (!shortage && !(buy.required_qty_base > 0)) continue;
      push({ ...base, kind: "DATA", level: shortage ? "URGENT" : "FIX_DATA", action: "Set Target / Critical days", by_when: shortage ?? null, qty: null, vendor: null,
        why: shortage ? `No Target set, so no buy can be planned — stock runs out ${shortage}.` : "No Target set, so no buy can be planned." });
    } else if (buy.status === "UNKNOWN_LEAD_TIME") {
      push({ ...base, kind: "DATA", level: shortage ? "URGENT" : "FIX_DATA", action: "Set vendor lead time / Booking Time", by_when: shortage ?? buy.need_date, qty: buy.recommended_po_qty_base, vendor: buy.vendor_label,
        why: `A buy is needed around ${buy.need_date} but the lead time is unknown, so the PO date cannot be calculated.` });
    }
  }
  for (const group of plan.group_assignments ?? []) {
    if (group.reason !== "NONE_SELECTED") continue;
    push({ kind: "DATA", level: "FIX_DATA", group_id: group.group_id, material: group.group_label, code: null, uom: null, action: "Set up a vendor for a member of this group",
      by_when: null, qty: group.uncovered_qty, vendor: null, why: `Group short ${String(group.month).slice(0, 7)} and no member has a vendor, so no buy can be planned.` });
  }
  for (const group of plan.group_actions ?? []) {
    const shortage = group.first_shortage_day ?? null;
    const critical = group.first_below_critical_day ?? null;
    if (!shortage && !critical) continue;
    push({
      kind: "GROUP_RISK", level: shortage ? "URGENT" : "SOON", group_id: group.group_id ?? null,
      material: group.group_label ?? "Eligible material group", code: null, uom: null,
      action: shortage ? "Resolve group stock-out risk" : "Resolve group Critical risk",
      by_when: shortage ?? critical, qty: group.unresolved_qty_base > 0 ? group.unresolved_qty_base : null, vendor: null,
      shortage_day: shortage, critical_day: critical,
      why: `Follow in order: ${(group.ordered_actions ?? []).join(" → ")}.`,
    });
  }
  for (const flag of plan.arrival_flags ?? []) {
    push({ kind: "DATA", level: "SOON", material_id: flag.material_id, material: flag.material_name, code: null, uom: null,
      action: flag.reason === "ETA_PASSED" ? "Update CSN ETA (overdue)" : "Enter CSN ETA", by_when: asOf, qty: null, vendor: null, why: `${flag.document}: ${flag.message}` });
  }
  return rows.sort((a, b) => ACTION_LEVELS[a.level].rank - ACTION_LEVELS[b.level].rank
    || String(a.by_when ?? "9999").localeCompare(String(b.by_when ?? "9999")) || String(a.material).localeCompare(String(b.material)));
}

function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
