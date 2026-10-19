import { financingCost, interestPctAt, parseProviderRate, pickCsnFxRate, pickFxRate, type FxRateRow } from "./mts_planning_cost.logic.ts";

function equal(actual: unknown, expected: unknown, message: string) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
const rows: FxRateRow[] = [
  { currency_code: "USD", rate_date: "2026-10-16", inr_per_unit: 83.1, source: "AUTO" },
  { currency_code: "USD", rate_date: "2026-10-19", inr_per_unit: 83.4, source: "AUTO" },
  { currency_code: "USD", rate_date: "2026-10-19", inr_per_unit: 83.5, source: "MANUAL" },
];

Deno.test("FX: manual beats auto on the same date; earlier date is stale; INR = 1", () => {
  equal(pickFxRate(rows, "USD", "2026-10-19"), { inr_per_unit: 83.5, rate_date: "2026-10-19", source: "MANUAL", stale: false }, "manual wins");
  equal(pickFxRate(rows, "usd", "2026-10-18"), { inr_per_unit: 83.1, rate_date: "2026-10-16", source: "AUTO", stale: true }, "weekend uses last rate");
  equal(pickFxRate(rows, "USD", "2026-10-01"), null, "no rate");
  equal(pickFxRate(rows, "INR", "2026-10-01")?.inr_per_unit, 1, "base currency");
});

Deno.test("FX D11: BOE rate > table rate on BOE date > today", () => {
  equal(pickCsnFxRate(rows, "USD", "2026-10-19", "2026-10-16", 84).source, "BOE", "BOE rate");
  equal(pickCsnFxRate(rows, "USD", "2026-10-19", "2026-10-16", null)?.inr_per_unit, 83.1, "BOE date rate");
  equal(pickCsnFxRate(rows, "USD", "2026-10-19", null, null)?.inr_per_unit, 83.5, "today when BOE date blank");
});

Deno.test("interest % effective-dated; financing = value x % x days / 365", () => {
  const interest = [{ effective_from: "2026-04-01", interest_pct_per_year: 12 }, { effective_from: "2026-10-01", interest_pct_per_year: 10 }];
  equal([interestPctAt(interest, "2026-09-30"), interestPctAt(interest, "2026-10-19"), interestPctAt(interest, "2026-01-01")], [12, 10, null], "dated");
  equal(financingCost(150_000, 12, 75), 3698.63, "VAE example: 1t at 150/kg, 75 days");
  equal(financingCost(1000, null, 10), null, "no rate set");
  equal(financingCost(1000, 12, -5), 0, "never negative");
});

Deno.test("provider reply parsing", () => {
  equal(parseProviderRate({ date: "2026-10-16", rates: { INR: 83.12 } }), { rate: 83.12, date: "2026-10-16" }, "ok");
  equal(parseProviderRate({ rates: { INR: "x" } }), null, "bad");
});
