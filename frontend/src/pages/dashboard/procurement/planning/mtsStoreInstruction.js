/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/mtsStoreInstruction.js
 * Purpose: PO22 Store instructions (owner 2026-10-28) — the Item table: one row per Period × Item × Material group × PO21 parent group.
 *          The child groups of ONE parent that use the same item are shown together on that row (not one row per child group).
 *          Pure display helper; quantities come from the backend engine's store rows.
 */
const split = (value) => String(value ?? "").split(";").map((s) => s.trim()).filter(Boolean);
const round = (value) => Math.round((Number(value) || 0) * 1000) / 1000;

/** rows: { period, period_order, item, group, mother, child, qty, not_backed, uom, key_id } (normalised by the caller). */
export function aggregateStoreItems(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = [r.period, r.key_id ?? r.item, r.group ?? "", r.mother ?? ""].join("|");
    const seen = map.get(key) ?? { key, period: r.period, period_order: r.period_order ?? 0, item: r.item, group: r.group ?? "", mother: r.mother ?? "", children: new Set(), qty: 0, not_backed: 0, uom: r.uom ?? "", key_id: r.key_id ?? null };
    split(r.child).forEach((c) => seen.children.add(c));
    seen.qty += Number(r.qty) || 0;
    seen.not_backed += Number(r.not_backed) || 0;
    map.set(key, seen);
  }
  return [...map.values()]
    .map((r) => {
      const child = [...r.children].sort().join("; ");
      const rest = { ...r, child, qty: round(r.qty), not_backed: round(r.not_backed) };
      delete rest.children;
      return rest;
    })
    .sort((a, b) => a.period_order - b.period_order || String(a.mother || "~").localeCompare(String(b.mother || "~")) || String(a.item).localeCompare(String(b.item)) || String(a.group).localeCompare(String(b.group)));
}

/** Backend `store_rows` (UI shape) -> the normalised rows above. A group remainder with no material is listed as "Group — not assigned". */
export function normaliseStoreRows(storeRows) {
  return (storeRows ?? []).map((r) => ({
    period: r.period_label ?? (r.period === "CM" ? "CM (rest)" : "NM"),
    period_order: r.period === "CM" ? 0 : 1,
    item: r.material_id ? r.material_name : `${r.group_label ?? "Group"} — not assigned`,
    key_id: r.material_id ?? `group:${r.group_id ?? r.group_label}`,
    group: r.group_label ?? "",
    mother: r.mother_group ?? "",
    child: r.child_group ?? "",
    qty: r.executable_qty,
    not_backed: r.not_backed_qty,
    uom: r.uom ?? "",
    material_id: r.material_id ?? null,
  }));
}

/** Transfers table rows (backend `store_transfers`) in reading order: by date, item, from, to. */
export function transferRows(transfers) {
  return [...(transfers ?? [])].sort((a, b) => String(a.by).localeCompare(String(b.by)) || String(a.material_name).localeCompare(String(b.material_name)) || String(a.from).localeCompare(String(b.from)) || String(a.to).localeCompare(String(b.to)));
}
