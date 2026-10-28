import { additionalReservationForPlanFeedAllocation, availableForPlanFeed, calculatePackingOrderFoCapacity } from "./packing_order_fo_capacity.ts";

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

Deno.test("reducing a partially dispatched FO allocation releases only its outstanding reservation", () => {
  const capacity = calculatePackingOrderFoCapacity(60 * 230, [
    { plan_feed_id: "fo-a", allocated_qty_kg: 60 * 230 },
  ], [
    { plan_feed_id: "fo-a", quantity: 46 * 230 },
  ]);

  assertEqual(capacity.free_qty_kg, 0, "the undisbursed 14 barrels remain reserved before remapping");
  assertEqual(
    additionalReservationForPlanFeedAllocation(capacity, "fo-a", 60 * 230, 46 * 230),
    0,
    "reducing the gross allocation to the dispatched quantity needs no new stock",
  );
  assertEqual(
    additionalReservationForPlanFeedAllocation(capacity, "fo-a", 60 * 230, 61 * 230),
    230,
    "an increase still needs one more barrel of physical capacity",
  );

  const afterReduction = calculatePackingOrderFoCapacity(60 * 230, [
    { plan_feed_id: "fo-a", allocated_qty_kg: 46 * 230 },
  ], [
    { plan_feed_id: "fo-a", quantity: 46 * 230 },
  ]);
  assertEqual(afterReduction.free_qty_kg, 14 * 230, "the 14 undisbursed barrels become free");
  assertEqual(availableForPlanFeed(afterReduction, "fo-b"), 14 * 230, "a different FO can map the released barrels");
});
