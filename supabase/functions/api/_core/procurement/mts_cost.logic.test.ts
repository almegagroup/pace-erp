import { averageOrderCost, costOption, economicCycleDays, landedAdder, rankCostOptions, resolvePurchaseCurrency, type CostVendorInput } from "./mts_cost.logic.ts";

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

Deno.test("cost: linked PO currency wins over blank or stale vendor-material currency", () => {
  equal(resolvePurchaseCurrency({ po_line_currency: "inr", vmi_last_purchase_currency: null, vmi_default_currency: null }), "INR", "PO INR fallback");
  equal(resolvePurchaseCurrency({ po_line_currency: "USD", vmi_last_purchase_currency: "INR", vmi_default_currency: "EUR" }), "USD", "PO is the priced-source authority");
  equal(resolvePurchaseCurrency({ po_line_currency: null, vmi_last_purchase_currency: null, vmi_default_currency: "usd" }), "USD", "default VMI fallback");
  equal(resolvePurchaseCurrency({}), null, "unknown remains unknown");
});

Deno.test("cost: domestic FOR price may include landed cost without an AC01 add-on", () => {
  const included = costOption(vendor({ landed_adder: 0, landed_basis: "INCLUDED_IN_PO_RATE" }), context);
  if (included.missing.includes("landed cost history")) throw new Error("FOR included rate must not be flagged as missing landed cost");
});

Deno.test("P2 economicCycleDays: √(2S/(D·H)), clamped 7–90, null when data is missing", () => {
  // S 50,000 per order, price 340/kg, interest 12 %, use 4,400 kg/day → H = 0.1118/kg/day
  // √(100000 / (4400 × 0.11178)) = √203.3 ≈ 14.3 → 14 days.
  const days = economicCycleDays({ order_cost: 50000, unit_price_inr: 340, interest_pct: 12, daily_use: 4400 });
  if (days !== 14) throw new Error(`expected 14, got ${days}`);
  if (economicCycleDays({ order_cost: 1, unit_price_inr: 340, interest_pct: 12, daily_use: 4400 }) !== 7) throw new Error("min clamp");
  if (economicCycleDays({ order_cost: 1e9, unit_price_inr: 1, interest_pct: 1, daily_use: 1 }) !== 90) throw new Error("max clamp");
  if (economicCycleDays({ order_cost: null, unit_price_inr: 340, interest_pct: 12, daily_use: 4400 }) !== null) throw new Error("missing S");
  if (averageOrderCost([{ total_cost: 100 }, { total_cost: 300 }, { total_cost: 0 }]) !== 200) throw new Error("avg order cost");
});

Deno.test("cost (owner 2026-10-21): a lower price can lose on payment term, freight and MOQ excess", () => {
  // A: ₹98, advance 60 days, freight paid by us ₹4, MOQ 5000 for a 1000 need. B: ₹100, 60 days credit, FOR.
  const a = costOption(vendor({ vendor_label: "A", price: 98, landed_adder: 4, advance: true, lead_time_days: 60, vendor_credit_days: null, order_qty: 5000 }), context);
  const b = costOption(vendor({ vendor_label: "B", price: 100, landed_adder: 0, vendor_credit_days: 60, order_qty: 1000 }), context);
  equal(rankCostOptions([a, b]).map((o) => o.vendor_label), ["B", "A"], "B wins on full cost despite the higher price");
  if (!(a.excess_cost! > 0 && a.days_money_tied! > b.days_money_tied!)) throw new Error("A pays for MOQ excess and longer money tie-up");
});
