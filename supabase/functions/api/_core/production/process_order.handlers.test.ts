// Run: SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY=x deno test --no-check --allow-read --allow-env --allow-net
// The production import pulls in serviceRoleClient; these tests make no network calls.
import { resolveMtsPackingPmActualQty } from "./process_order.handlers.ts";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

Deno.test("MTS Verify consumes the exact saved total for a full mixed-alternate Packing PO", () => {
  // PM-00084 on PO 9400000934: the 773 exact bags are represented as
  // 773 / 2790 = 0.277061 per bag.  Re-multiplying creates 773.000190.
  assertEqual(
    resolveMtsPackingPmActualQty({
      totalQty: 773,
      qtyPerPack: 0.277061,
      plannedPacks: 2790,
      actualPacks: 2790,
    }),
    773,
    "full output must consume its reserved total exactly",
  );
});

Deno.test("MTS Verify proportionally scales a saved PM total for a partial output", () => {
  assertEqual(
    resolveMtsPackingPmActualQty({
      totalQty: 773,
      qtyPerPack: 0.277061,
      plannedPacks: 2790,
      actualPacks: 1395,
    }),
    386.5,
    "partial output must retain the saved-total ratio",
  );
});

Deno.test("MTS Verify retains legacy per-pack calculation when no total was saved", () => {
  assertEqual(
    resolveMtsPackingPmActualQty({
      totalQty: null,
      qtyPerPack: 0.5,
      plannedPacks: 10,
      actualPacks: 4,
    }),
    2,
    "legacy PM line fallback",
  );
});
