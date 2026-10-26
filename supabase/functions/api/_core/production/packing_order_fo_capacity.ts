/*
 * Packing-PO capacity reserved for Plan Feed FOs.
 *
 * A Plan Feed allocation reserves physical output only until that same FO has
 * dispatched it.  Counting both the allocation and the dispatched DO line as
 * separate claims makes a partial dispatch consume the quantity twice: a
 * 30-barrel PO with 15 barrels allocated and dispatched incorrectly appears
 * to have no room for the remaining 15 barrels.  Keep the arithmetic pure so
 * every production surface applies the identical reservation rule.
 */

export type PackingOrderFoAllocation = {
  plan_feed_id: string;
  allocated_qty_kg: number;
};

export type PackingOrderDispatch = {
  quantity: number;
  plan_feed_id?: string | null;
};

export type PackingOrderFoCapacity = {
  total_output_qty_kg: number;
  allocated_qty_kg: number;
  dispatched_qty_kg: number;
  free_qty_kg: number;
  reserved_by_plan_feed: Map<string, number>;
};

const QTY_TOL = 0.0001;

function qty(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

// `free_qty_kg` is physical stock that is neither already dispatched nor
// still reserved by an FO. A dispatch linked to an FO releases only that FO's
// matching reservation; an unlinked dispatch remains a physical reduction.
export function calculatePackingOrderFoCapacity(
  totalOutputQtyKg: unknown,
  allocations: PackingOrderFoAllocation[],
  dispatches: PackingOrderDispatch[],
): PackingOrderFoCapacity {
  const allocatedByFo = new Map<string, number>();
  for (const row of allocations) {
    const planFeedId = String(row.plan_feed_id ?? "").trim();
    if (!planFeedId) continue;
    allocatedByFo.set(planFeedId, (allocatedByFo.get(planFeedId) ?? 0) + qty(row.allocated_qty_kg));
  }

  const dispatchedByFo = new Map<string, number>();
  let dispatchedQtyKg = 0;
  for (const row of dispatches) {
    const dispatchedQty = qty(row.quantity);
    dispatchedQtyKg += dispatchedQty;
    const planFeedId = String(row.plan_feed_id ?? "").trim();
    if (planFeedId) dispatchedByFo.set(planFeedId, (dispatchedByFo.get(planFeedId) ?? 0) + dispatchedQty);
  }

  const reservedByFo = new Map<string, number>();
  for (const [planFeedId, allocatedQty] of allocatedByFo) {
    const outstanding = Math.max(0, allocatedQty - (dispatchedByFo.get(planFeedId) ?? 0));
    if (outstanding > QTY_TOL) reservedByFo.set(planFeedId, outstanding);
  }

  const physicalAvailableQty = Math.max(0, qty(totalOutputQtyKg) - dispatchedQtyKg);
  const reservedQty = [...reservedByFo.values()].reduce((sum, value) => sum + value, 0);
  return {
    total_output_qty_kg: qty(totalOutputQtyKg),
    allocated_qty_kg: [...allocatedByFo.values()].reduce((sum, value) => sum + value, 0),
    dispatched_qty_kg: dispatchedQtyKg,
    free_qty_kg: Math.max(0, physicalAvailableQty - reservedQty),
    reserved_by_plan_feed: reservedByFo,
  };
}

export function availableForPlanFeed(capacity: PackingOrderFoCapacity, planFeedId: string): number {
  const ownReservation = capacity.reserved_by_plan_feed.get(String(planFeedId ?? "").trim()) ?? 0;
  return capacity.free_qty_kg + ownReservation;
}
