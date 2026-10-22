/*
 * File-Path: supabase/functions/api/_shared/groupUsageOrder.logic.ts
 * Purpose: PO22 Group Settings (owner 2026-10-22) — which member of a material group is used
 *          first. Pure ordering shared by PO22 planning (allocateDemand) and the MTS production
 *          auto-derive (computeMtsAutoDeriveRowsForGroup), so both pick members the same way.
 *          No setting for a group = each caller keeps its own default (planning Method C,
 *          production §138.12).
 */

export type GroupUsageOrderMode = "MOST_STOCK_FIRST" | "LEAST_STOCK_FIRST" | "FIXED_ORDER";

export type GroupUsageOrder = {
  mode: GroupUsageOrderMode;
  /** FIXED_ORDER only: members in the order they are used. */
  member_order: string[];
};

export const GROUP_USAGE_ORDER_MODES: readonly GroupUsageOrderMode[] = ["MOST_STOCK_FIRST", "LEAST_STOCK_FIRST", "FIXED_ORDER"];

/**
 * Candidates in the order they should be drawn. Ties keep the incoming order (so the BOM /
 * stroke line's own item, listed first by every caller, wins a tie). FIXED_ORDER: members in
 * member_order first, any member missing from that list after them in the incoming order.
 */
export function orderByGroupUsage(candidates: readonly string[], free: (id: string) => number, order: GroupUsageOrder): string[] {
  const indexed = candidates.map((id, index) => ({ id, index, free: free(id) }));
  if (order.mode === "FIXED_ORDER") {
    const rank = new Map(order.member_order.map((id, index) => [id, index]));
    const at = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
    return indexed.sort((a, b) => at(a.id) - at(b.id) || a.index - b.index).map((e) => e.id);
  }
  const sign = order.mode === "MOST_STOCK_FIRST" ? -1 : 1;
  return indexed.sort((a, b) => sign * (a.free - b.free) || a.index - b.index).map((e) => e.id);
}

/** The setting in force on `asOf`: current row with the latest effective_from <= asOf. */
export function effectiveGroupUsageOrders(
  rows: readonly { material_group_id: string; effective_from: string; order_mode: string; member_order: readonly string[] }[],
  asOf: string,
): Map<string, GroupUsageOrder> {
  const best = new Map<string, { from: string; order: GroupUsageOrder }>();
  for (const row of rows) {
    if (row.effective_from > asOf) continue;
    if (!GROUP_USAGE_ORDER_MODES.includes(row.order_mode as GroupUsageOrderMode)) continue;
    const seen = best.get(row.material_group_id);
    if (seen && seen.from >= row.effective_from) continue;
    best.set(row.material_group_id, {
      from: row.effective_from,
      order: { mode: row.order_mode as GroupUsageOrderMode, member_order: [...row.member_order] },
    });
  }
  return new Map([...best].map(([id, v]) => [id, v.order]));
}
