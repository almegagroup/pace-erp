/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/mtsStoreInstruction.js
 * Purpose: PO22 Store instructions (owner 2026-10-28) — the Item table: one row per Period × Item × Material group × PO21 parent group.
 *          The child groups of ONE parent that use the same item are shown together on that row (not one row per child group).
 *          Pure display helper; quantities come from the backend engine's store rows.
 */
const split = (value) => String(value ?? "").split(";").map((s) => s.trim()).filter(Boolean);
const round = (value) => Math.round((Number(value) || 0) * 1000) / 1000;

/**
 * rows: { period, period_order, period_from, period_to, item, group, mother, child, qty, not_backed, uom, key_id, keep, keep_days } (normalised by the caller).
 * `keep` = what must be KEPT at the end of the period (the level's reserve of this item, up to its Max days). It belongs to Period × Item × Group,
 * not to a parent group, so when one item is shown for several parent groups it is shared in proportion to the quantity each uses.
 */
export function aggregateStoreItems(rows) {
  const map = new Map();
  const keepOf = new Map();
  for (const r of rows) {
    const base = [r.period, r.key_id ?? r.item, r.group ?? ""].join("|");
    if (r.keep !== null && r.keep !== undefined) keepOf.set(base, { keep: Number(r.keep) || 0, days: r.keep_days ?? null });
    const key = `${base}|${r.mother ?? ""}`;
    const seen = map.get(key) ?? { key, base, period: r.period, period_order: r.period_order ?? 0, period_from: r.period_from ?? null, period_to: r.period_to ?? null, item: r.item, group: r.group ?? "", mother: r.mother ?? "", children: new Set(), qty: 0, not_backed: 0, uom: r.uom ?? "", key_id: r.key_id ?? null };
    split(r.child).forEach((c) => seen.children.add(c));
    seen.qty += Number(r.qty) || 0;
    seen.not_backed += Number(r.not_backed) || 0;
    map.set(key, seen);
  }
  const totalUse = new Map();
  for (const r of map.values()) totalUse.set(r.base, (totalUse.get(r.base) ?? 0) + r.qty);
  return [...map.values()]
    .map((r) => {
      const child = [...r.children].sort().join("; ");
      const kept = keepOf.get(r.base);
      const share = kept ? (totalUse.get(r.base) > 0 ? r.qty / totalUse.get(r.base) : 1) : 0;
      const rest = { ...r, child, qty: round(r.qty), not_backed: round(r.not_backed), keep: kept ? round(kept.keep * share) : null, keep_days: kept?.days ?? null };
      delete rest.children;
      delete rest.base;
      return rest;
    })
    .sort((a, b) => a.period_order - b.period_order || String(a.mother || "~").localeCompare(String(b.mother || "~")) || String(a.item).localeCompare(String(b.item)) || String(a.group).localeCompare(String(b.group)));
}

/** "28 Oct → 31 Oct" */
export function periodSpan(from, to) {
  if (!from || !to) return "";
  const show = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${show(from)} → ${show(to)}`;
}

/** Backend `store_rows` (UI shape) -> the normalised rows above; only GROUP items (a group's member with an exclusive use included). */
export function normaliseStoreRows(storeRows) {
  return (storeRows ?? []).filter((r) => r.group_related !== false).map((r) => ({
    period: r.period_label ?? (r.period === "CM" ? "CM (rest)" : "NM"),
    period_order: r.period === "CM" ? 0 : 1,
    period_from: r.period_from ?? null,
    period_to: r.period_to ?? null,
    item: r.material_id ? r.material_name : `${r.group_label ?? "Group"} — not assigned`,
    key_id: r.material_id ?? `group:${r.group_id ?? r.group_label}`,
    group: r.group_label ?? "",
    mother: r.mother_group ?? "",
    child: r.child_group ?? "",
    qty: r.executable_qty,
    not_backed: r.not_backed_qty,
    uom: r.uom ?? "",
    material_id: r.material_id ?? null,
    keep: r.keep_qty ?? null,
    keep_days: r.keep_max_days ?? null,
  }));
}

/** Transfers table rows (backend `store_transfers`) in reading order: by date, item, from, to. */
export function transferRows(transfers) {
  return [...(transfers ?? [])].sort((a, b) => String(a.by).localeCompare(String(b.by)) || String(a.material_name).localeCompare(String(b.material_name)) || String(a.from).localeCompare(String(b.from)) || String(a.to).localeCompare(String(b.to)));
}

/**
 * The month-by-month Store plan (backend `store_plan.rows`): one row per Period x Item x Material group x PO21 parent group, child groups together.
 * Only ACTUAL stock may be issued; the other three parts are planning information (not received yet).
 */
export function planItemRows(planRows) {
  return [...(planRows ?? [])].map((r) => ({
    key: [r.period_order, r.material_id ?? r.material_key ?? r.item, r.group_id ?? r.group ?? "", r.mother_group ?? "", r.level_kind ?? ""].join("|"),
    period: r.period_label ?? r.period, period_order: r.period_order ?? 0, period_from: r.period_from, period_to: r.period_to,
    item: r.material_name ?? r.item, key_id: r.material_id ?? r.material_key ?? `group:${r.group_id ?? r.group}`, group: r.group_label ?? r.group ?? "",
    mother: r.mother_group ?? "", child: r.child_group ?? "", uom: r.uom ?? "", material_id: r.material_id ?? null,
    use_stock: r.use_stock ?? 0, use_arrival: r.use_arrival ?? 0, use_assumed: r.use_assumed ?? 0, use_lot: r.use_lot ?? 0,
    keep: r.keep_qty ?? null, keep_days: r.keep_max_days ?? null, not_backed: r.not_backed_qty ?? r.not_backed ?? 0,
  })).sort((a, b) => a.period_order - b.period_order || String(a.mother || "~").localeCompare(String(b.mother || "~")) || String(a.item).localeCompare(String(b.item)) || String(a.group).localeCompare(String(b.group)));
}

/** Plain sentence for a row: how much Store may issue now and what still depends on a receipt. */
export function issueNote(row) {
  const waiting = (row.use_arrival ?? 0) + (row.use_assumed ?? 0) + (row.use_lot ?? 0);
  if (waiting <= 0.0005) return "";
  const parts = [];
  if (row.use_arrival > 0.0005) parts.push("a CSN/PO not received yet");
  if (row.use_assumed > 0.0005) parts.push("a piece whose ETA passed or is missing");
  if (row.use_lot > 0.0005) parts.push("a lot nobody has ordered");
  return `Do not issue against: ${parts.join(", ")}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Simple Store view (owner 2026-10-28: the full table confused users).
// One row: Period · Item · For (PO21 group) · Issue now · Wait for receipt · Keep after this period · UoM · Note.
// ─────────────────────────────────────────────────────────────────────────────

/** "PUTTY (TRUECARE+SUPREMA; WATERPROOF)": the PO21 parent group with its child groups, else the planning group. */
export function storeForText(row) {
  const mother = row.mother ?? row.mother_group ?? "";
  const child = row.child ?? row.child_group ?? "";
  if (mother) return child ? `${mother} (${child})` : mother;
  return row.group ?? "";
}

/** Quantity that must wait for a receipt: a CSN/PO not yet received, an ETA that passed or is missing, an unordered lot. */
export function storeWaitQty(row) {
  return (row.use_arrival ?? 0) + (row.use_assumed ?? 0) + (row.use_lot ?? 0);
}

/** One plain sentence per row, quantities formatted by `fmt`. Empty when Store can issue everything now. */
export function simpleStoreNote(row, fmt = (q) => String(q)) {
  const parts = [];
  if ((row.use_arrival ?? 0) > 0.0005) parts.push(`${fmt(row.use_arrival)} only after its CSN/PO is received`);
  if ((row.use_assumed ?? 0) > 0.0005) parts.push(`${fmt(row.use_assumed)} depends on a CSN/PO whose ETA passed or is missing: do not issue`);
  if ((row.use_lot ?? 0) > 0.0005) parts.push(`${fmt(row.use_lot)} depends on a lot nobody has ordered: do not issue`);
  if ((row.not_backed ?? 0) > 0.0005) parts.push(`${fmt(row.not_backed)} is not covered by any stock or order`);
  return parts.join(" · ");
}
