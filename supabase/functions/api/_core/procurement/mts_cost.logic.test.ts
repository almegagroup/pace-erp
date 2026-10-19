import { costOption, landedAdder, rankCostOptions, type CostVendorInput } from "./mts_cost.logic.ts";

function equal(actual: unknown, expected: unknown, message: string) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
const vendor = (over: Partial<CostVendorInput>): CostVendorInput => ({
  vendor_label: "V", price: 100, currency: "INR", fx_inr: 1, fx_source: "BASE", landed_adder: 5, landed_basis: "FINAL",
  vendor_credit_days: 30, advance: false, order_qty: 1000, lead_time_days: 10, feasible: true, ...over,
});
const context = { required_qty: 1000, daily_use: 50, carrying_rate: 1, interest_pct: 12, customer_credit_days: 15 };

Deno.test("cost: price + landed + carrying + financing on the full cash cycle", () => {
  const option = costOption(vendor({}), context);
  // 1000 / 50 / 2 = 10 days in stock; tied = 10 + 15 − 30 = 0 (vendor credit covers it)
  equal([option.avg_days_in_stock, option.days_money_tied, option.financing_per_unit, option.total_per_unit, option.total_cost], [10, 0, 0, 106, 106000], "credit vendor");
  const advance = costOption(vendor({ advance: true, lead_time_days: 40 }), context);
  // tied = 10 + 15 + 40 = 65 days → 100 × 12% × 65/365 = 2.14
  equal([advance.days_money_tied, advance.financing_per_unit, advance.total_per_unit], [65, 2.14, 108.14], "advance pays before receipt");
});

Deno.test("cost: import USD with MOQ excess — excess counts only carrying + financing", () => {
  const imp = costOption(vendor({ vendor_label: "IMP", price: 1.1, currency: "USD", fx_inr: 83.5, order_qty: 25000, landed_adder: 12, vendor_credit_days: 0 }), context);
  equal([imp.unit_price_inr, imp.excess_qty, imp.avg_days_in_stock], [91.85, 24000, 250], "converted price, large excess sits long");
  const local = costOption(vendor({ vendor_label: "LOC", price: 100, order_qty: 1000 }), context);
  const ranked = rankCostOptions([imp, local]);
  equal(ranked.map((o) => [o.vendor_label, o.rank]), [["LOC", 1], ["IMP", 2]], "MOQ excess financing makes the cheap import dearer here");
});

Deno.test("cost: unknown components are reported; unpriced or infeasible options rank last", () => {
  const noPrice = costOption(vendor({ vendor_label: "NP", price: null }), { ...context, interest_pct: null });
  equal([noPrice.total_cost, noPrice.missing], [null, ["price", "interest %"]], "never assumed zero");
  const late = costOption(vendor({ vendor_label: "LATE", price: 50, feasible: false }), context);
  const ok = costOption(vendor({ vendor_label: "OK", price: 100 }), context);
  equal(rankCostOptions([noPrice, late, ok]).map((o) => [o.vendor_label, o.rank]), [["OK", 1], ["LATE", 2], ["NP", null]], "feasible first");
});

Deno.test("landed adder from AC01 history", () => {
  equal(landedAdder([{ total_cost: 5000, received_base_qty: 1000, status: "POSTED" }, { total_cost: 2500, received_base_qty: 500, status: "DRAFT" }]), { adder: 5, basis: "PROVISIONAL" }, "draft makes it provisional");
  equal(landedAdder([]), { adder: null, basis: "NONE" }, "no history");
});
