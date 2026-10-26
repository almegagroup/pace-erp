import { availableForPlanFeed, calculatePackingOrderFoCapacity } from "./packing_order_fo_capacity.ts";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

Deno.test("a dispatched FO allocation is not counted twice against its Packing PO", () => {
  const capacity = calculatePackingOrderFoCapacity(30 * 230, [
    { plan_feed_id: "fo-a", allocated_qty_kg: 15 * 230 },
  ], [
    { plan_feed_id: "fo-a", quantity: 15 * 230 },
  ]);

  assertEqual(capacity.free_qty_kg, 15 * 230, "remaining physical capacity");
  assertEqual(availableForPlanFeed(capacity, "fo-b"), 15 * 230, "second FO capacity");
});

Deno.test("an unlinked dispatch and an outstanding FO reservation both consume Packing PO capacity", () => {
  const capacity = calculatePackingOrderFoCapacity(6900, [
    { plan_feed_id: "fo-a", allocated_qty_kg: 3450 },
  ], [
    { quantity: 1000 },
  ]);

  assertEqual(capacity.free_qty_kg, 2450, "free capacity after independent dispatch");
  assertEqual(availableForPlanFeed(capacity, "fo-b"), 2450, "other FO capacity");
});
