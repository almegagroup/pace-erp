/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/mtsWaterfall.js
 * Purpose: PO22 4A family table (owner 2026-10-28, docs/mts-planning/PO22-WATERFALL-OWNER-METHOD-2026-10-28.md §13).
 *          Pure helpers: the one plain sentence on top, the Block 2 rows and the Block 2B Material x Level grid.
 *          Every number comes from the backend engine (`plan.waterfall`); nothing is calculated here except sums for display.
 */
const KG = (value) => Math.round(Number(value) || 0).toLocaleString("en-IN");

export function eventText(event) {
  if (event.kind === "OPENING_RESERVE") return "Opening reserve to Max";
  if (event.kind === "RECEIPT") return `Receipt lands in the pool${event.references?.length ? ` (${event.references.join(", ")})` : ""}`;
  if (event.kind === "WAITING") return "At / below Min — waiting, pool has nothing to give";
  return "At Min — tops up to Max from the pool";
}

/** One row per event day; a receipt shows its material, a top-up shows who gave what. */
export function flowRows(waterfall) {
  return (waterfall?.events ?? []).map((event, index) => ({
    key: `${event.day}|${event.kind}|${event.level}|${index}`,
    day: event.day,
    what: eventText(event),
    level: event.level,
    qty: event.qty,
    detail: event.kind === "RECEIPT" ? event.material ?? "" : (event.by_material ?? []).map((m) => `${m.material}: ${KG(m.qty)}`).join("; "),
    wanted: event.wanted,
    shortfall: event.shortfall,
    pool_before: event.pool_before,
    pool_after: event.pool_after,
    short: event.shortfall > 1,
  }));
}

/** Material x Level grid of one snapshot day: a row per material, a column per level, then Pool and total stock (checksummed). */
export function matrixGrid(waterfall, day) {
  const snapshot = (waterfall?.matrix ?? []).find((s) => s.day === day) ?? (waterfall?.matrix ?? [])[0] ?? null;
  if (!snapshot) return { day: null, levels: [], rows: [], ok: true };
  const levels = snapshot.levels.map((l) => l.level);
  const qtyOf = (list, material) => list.find((m) => m.material === material)?.qty ?? 0;
  const materials = snapshot.closing.map((m) => m.material);
  const rows = materials.map((material) => {
    const cells = snapshot.levels.map((l) => qtyOf(l.by_material, material));
    const pool = qtyOf(snapshot.pool, material);
    const total = qtyOf(snapshot.closing, material);
    const held = cells.reduce((s, q) => s + q, 0) + pool;
    return { material, cells, pool, total, held, ok: Math.abs(held - total) < 1 };
  });
  return { day: snapshot.day, levels, rows, ok: rows.every((r) => r.ok) };
}

/** The sentence a reader sees first: which level is short, by how much, and the order that closes it. */
export function waterfallVerdict(waterfall, futureOrders = []) {
  const events = waterfall?.events ?? [];
  const firstShort = new Map();
  for (const event of events) {
    if (event.level_kind === "POOL" || !(event.shortfall > 1)) continue;
    if (!firstShort.has(event.level)) firstShort.set(event.level, event);
  }
  if (firstShort.size === 0) return { tone: "ok", text: "Every level is filled to its Max from the pool for the whole horizon. No order is needed for the waterfall." };
  const parts = [...firstShort.values()].map((event) => `${event.level} will be short about ${KG(event.shortfall)} KG from ${event.day}`);
  if (futureOrders === null) return { tone: firstShort.size && [...firstShort.keys()].some((l) => String(l).startsWith("Exclusive")) ? "bad" : "warn", text: `${[...firstShort.values()].map((event) => `${event.level} will be short about ${KG(event.shortfall)} KG from ${event.day}`).join("; ")}.` };
  const order = (futureOrders ?? []).filter((o) => o.po_by).sort((a, b) => String(a.po_by).localeCompare(String(b.po_by)))[0];
  const action = order ? ` Order ${order.material_name} (${KG(order.qty)}) by ${order.po_by}; it lands ${order.eta_plant}.` : " No engine order covers it yet.";
  const narrow = [...firstShort.keys()].filter((l) => String(l).startsWith("Exclusive"));
  return { tone: narrow.length ? "bad" : "warn", text: `${parts.join("; ")}.${action}` };
}
