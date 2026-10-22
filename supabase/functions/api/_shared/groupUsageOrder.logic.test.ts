// Run: SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY=x deno test --no-check --allow-read --allow-env --allow-net
// (the production import pulls in serviceRoleClient; no network call is made).
import { effectiveGroupUsageOrders, orderByGroupUsage } from "./groupUsageOrder.logic.ts";
import { computeMtsAutoDeriveRowsForGroup } from "../_core/production/process_order.handlers.ts";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected: ${e}\n  actual:   ${a}`);
}

const stock = new Map([["OWN", 90517], ["ALT", 17333]]);

Deno.test("orderByGroupUsage: most / least / fixed; ties keep the incoming order", () => {
  const free = (id: string) => stock.get(id) ?? 0;
  assertEqual(orderByGroupUsage(["OWN", "ALT"], free, { mode: "MOST_STOCK_FIRST", member_order: [] }), ["OWN", "ALT"], "most");
  assertEqual(orderByGroupUsage(["OWN", "ALT"], free, { mode: "LEAST_STOCK_FIRST", member_order: [] }), ["ALT", "OWN"], "least");
  assertEqual(orderByGroupUsage(["OWN", "ALT", "X"], free, { mode: "FIXED_ORDER", member_order: ["ALT"] }), ["ALT", "OWN", "X"], "fixed, unlisted after in incoming order");
  assertEqual(orderByGroupUsage(["OWN", "ALT"], () => 5, { mode: "LEAST_STOCK_FIRST", member_order: [] }), ["OWN", "ALT"], "tie → own item first");
});

Deno.test("effectiveGroupUsageOrders: latest effective_from on or before as-of", () => {
  const rows = [
    { material_group_id: "G", effective_from: "2026-10-01", order_mode: "LEAST_STOCK_FIRST", member_order: [] },
    { material_group_id: "G", effective_from: "2026-10-20", order_mode: "FIXED_ORDER", member_order: ["ALT"] },
    { material_group_id: "G", effective_from: "2026-11-01", order_mode: "MOST_STOCK_FIRST", member_order: [] },
  ];
  assertEqual(effectiveGroupUsageOrders(rows, "2026-10-22").get("G"), { mode: "FIXED_ORDER", member_order: ["ALT"] }, "20 Oct row");
  assertEqual(effectiveGroupUsageOrders(rows, "2026-09-30").has("G"), false, "before any setting");
});

Deno.test("production auto-derive: no setting keeps §138.12; a setting changes who is drawn first", () => {
  const base = { formulationMaterialId: "OWN", dosagePct: null, standardQty: 20000, alternateMaterialIds: ["ALT"] };
  const pick = (usageOrder?: { mode: "LEAST_STOCK_FIRST" | "MOST_STOCK_FIRST" | "FIXED_ORDER"; member_order: string[] }) =>
    computeMtsAutoDeriveRowsForGroup({ ...base, bucketBalances: new Map(stock), usageOrder }).rows
      .map((r) => [r.actual_material_id, r.actual_qty, r.planned_qty, r.stroke_line_material_id]);
  assertEqual(pick(), [["OWN", 20000, 20000, "OWN"]], "default: own item first");
  assertEqual(pick({ mode: "LEAST_STOCK_FIRST", member_order: [] }), [["ALT", 17333, 20000, "OWN"], ["OWN", 2667, 0, "OWN"]], "least: ALT emptied first, Standard stays on the first row");
});
