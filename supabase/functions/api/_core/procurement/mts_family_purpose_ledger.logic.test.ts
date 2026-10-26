import { runFamilyPurposeLedger } from "./mts_family_purpose_ledger.logic.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("W3g: one receipt carries direct, narrow and broad purpose balances without a daily refill", () => {
  const result = runFamilyPurposeLedger({
    opening: { BETONE: 320 }, supplies: [], days: 2,
    purposes: [
      { id: "DIRECT", priority: 1, candidates: ["BETONE"], demand: [20, 20], target_balance: [25, 25], desired_balance: [80, 80] },
      { id: "GROUP_A", priority: 2, candidates: ["BETONE"], demand: [25, 25], target_balance: [25, 25], desired_balance: [75, 75] },
      { id: "GROUP_B", priority: 3, candidates: ["BETONE"], demand: [30, 30], target_balance: [30, 30], desired_balance: [90, 90] },
    ],
  });
  const day0 = result.rows.filter((row) => row.day === 0);
  const day1 = result.rows.filter((row) => row.day === 1);
  assert(day0.find((row) => row.purpose_id === "DIRECT")?.closing_qty === 80, JSON.stringify(day0));
  assert(day0.find((row) => row.purpose_id === "GROUP_A")?.closing_qty === 75, JSON.stringify(day0));
  assert(day0.find((row) => row.purpose_id === "GROUP_B")?.closing_qty === 90, JSON.stringify(day0));
  assert(day1.every((row) => row.allocated_qty === 0), `day two must consume carried balances, not recreate Desired Max: ${JSON.stringify(day1)}`);
});

Deno.test("W3g: an eligible alternative is pre-allocated but VINNAPAS is consumed first", () => {
  const result = runFamilyPurposeLedger({
    opening: { VINNAPAS: 20, DA: 100 }, supplies: [], days: 2,
    purposes: [{ id: "RDP_TLA", priority: 1, candidates: ["VINNAPAS", "DA"], consume_order: ["VINNAPAS", "DA"], demand: [20, 20], target_balance: [10, 10], desired_balance: [30, 30] }],
  });
  const day0 = result.rows.find((row) => row.day === 0)!;
  assert(day0.opening_qty === 50 && day0.closing_qty === 30 && day0.by_material.DA === 30 && day0.consumed_by_material.VINNAPAS === 20,
    `the 20 KG VINNAPAS must be consumed before the pre-allocated DA balance: ${JSON.stringify(result.rows)}`);
});
