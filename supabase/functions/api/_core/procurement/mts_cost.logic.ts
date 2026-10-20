/*
 * PO22 cost-to-cost comparison (owner decisions D8/D10/D11, 2026-10-19). Pure; no database.
 *
 * Per vendor option, for one advisory buy:
 *   unit price (INR)   = last purchase price × FX (D11 precedence resolved by the caller)
 *   landed adder        = this vendor+material's historic landed-cost components per base unit
 *                         (AC01 POSTED = final, DRAFT = provisional)
 *   carrying            = item Rate per base unit (Material Settings, D10)
 *   financing           = value × interest % × days money is tied up / 365 (D11), where
 *                         days = average days in stock + customer credit days − vendor credit days
 *                         (advance terms pay before receipt: vendor credit = −lead time)
 * Excess from MOQ / multiple is not waste (it carries forward): only its financing + carrying count.
 * Unknown components are reported, never assumed zero, and an option with an unknown price is not ranked.
 */

export type CostVendorInput = {
  vendor_label: string;
  price: number | null;            // per base unit, in `currency`
  currency: string | null;
  fx_inr: number | null;           // INR per 1 currency unit (1 for INR)
  fx_source: string | null;
  landed_adder: number | null;     // INR per base unit
  landed_basis: "FINAL" | "PROVISIONAL" | "NONE";
  vendor_credit_days: number | null;
  advance: boolean;
  order_qty: number | null;        // after this vendor's MOQ / multiple
  lead_time_days: number | null;
  feasible: boolean;               // arrives by the need date
};

export type CostContext = {
  required_qty: number;
  daily_use: number;               // average daily use over CM + NM
  carrying_rate: number | null;    // INR per base unit
  interest_pct: number | null;     // per year
  customer_credit_days: number | null;
};

export type CostOption = CostVendorInput & {
  unit_price_inr: number | null;
  avg_days_in_stock: number | null;
  days_money_tied: number | null;
  financing_per_unit: number | null;
  total_per_unit: number | null;   // price + landed + carrying + financing, for the required qty
  excess_qty: number | null;
  excess_cost: number | null;      // carrying + financing of MOQ excess
  total_cost: number | null;       // required × total_per_unit + excess_cost
  missing: string[];
  rank: number | null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export function costOption(vendor: CostVendorInput, context: CostContext): CostOption {
  const missing: string[] = [];
  const unitPrice = vendor.price !== null && vendor.fx_inr !== null ? vendor.price * vendor.fx_inr : null;
  if (vendor.price === null) missing.push("price");
  if (vendor.price !== null && vendor.fx_inr === null) missing.push("exchange rate");
  if (vendor.landed_adder === null) missing.push("landed cost history");
  if (context.interest_pct === null) missing.push("interest %");
  if (context.customer_credit_days === null) missing.push("customer payment term");
  if (vendor.vendor_credit_days === null && !vendor.advance) missing.push("vendor payment term");
  const orderQty = vendor.order_qty ?? context.required_qty;
  const avgDays = context.daily_use > 0 ? orderQty / context.daily_use / 2 : null;
  const vendorCredit = vendor.advance ? -(vendor.lead_time_days ?? 0) : vendor.vendor_credit_days ?? 0;
  const daysTied = avgDays === null ? null : Math.max(0, avgDays + (context.customer_credit_days ?? 0) - vendorCredit);
  const financing = unitPrice === null || context.interest_pct === null || daysTied === null ? null : unitPrice * (context.interest_pct / 100) * (daysTied / 365);
  const perUnit = unitPrice === null ? null : unitPrice + (vendor.landed_adder ?? 0) + (context.carrying_rate ?? 0) + (financing ?? 0);
  const excess = Math.max(0, orderQty - context.required_qty);
  const excessCost = unitPrice === null ? null : excess * ((context.carrying_rate ?? 0) + (financing ?? 0));
  const total = perUnit === null || excessCost === null ? null : context.required_qty * perUnit + excessCost;
  return {
    ...vendor,
    unit_price_inr: unitPrice === null ? null : round2(unitPrice),
    avg_days_in_stock: avgDays === null ? null : round2(avgDays),
    days_money_tied: daysTied === null ? null : round2(daysTied),
    financing_per_unit: financing === null ? null : round2(financing),
    total_per_unit: perUnit === null ? null : round2(perUnit),
    excess_qty: round2(excess),
    excess_cost: excessCost === null ? null : round2(excessCost),
    total_cost: total === null ? null : round2(total),
    missing,
    rank: null,
  };
}

/** Ranks priced options: feasible first, then lowest total cost; unpriced options keep rank null. */
export function rankCostOptions(options: CostOption[]): CostOption[] {
  const priced = options.filter((o) => o.total_cost !== null)
    .sort((a, b) => Number(b.feasible) - Number(a.feasible) || (a.total_cost! - b.total_cost!) || a.vendor_label.localeCompare(b.vendor_label));
  const ranked = priced.map((o, index) => ({ ...o, rank: index + 1 }));
  return [...ranked, ...options.filter((o) => o.total_cost === null)];
}

/** Landed adder per base unit from AC01 history: Σ landed cost / Σ received base qty. */
export function landedAdder(rows: ReadonlyArray<{ total_cost: number; received_base_qty: number; status: string }>): { adder: number | null; basis: "FINAL" | "PROVISIONAL" | "NONE" } {
  const valid = rows.filter((r) => r.received_base_qty > 0 && Number.isFinite(r.total_cost));
  if (valid.length === 0) return { adder: null, basis: "NONE" };
  const qty = valid.reduce((s, r) => s + r.received_base_qty, 0);
  const cost = valid.reduce((s, r) => s + r.total_cost, 0);
  return { adder: Math.round((cost / qty) * 10000) / 10000, basis: valid.every((r) => r.status === "POSTED") ? "FINAL" : "PROVISIONAL" };
}

/*
 * P2 Max days (owner 2026-10-20: engine + AI, never user-entered; working capital matters).
 * Best order cycle = economic order interval √(2·S / (D·H)):
 *   S = cost of one order (average AC01 landed cost per GRN of this vendor + material)
 *   D = average daily use, H = money tied up per unit per day = price (INR) × interest % / 365.
 * Clamped to 7 – 90 days. Missing data → null (the caller uses DEFAULT_CYCLE_DAYS and says so).
 * Max days = Target + cycle.
 */
export const MIN_CYCLE_DAYS = 7;
export const MAX_CYCLE_DAYS = 90;
export const DEFAULT_CYCLE_DAYS = 30;

export function economicCycleDays(input: { order_cost: number | null; unit_price_inr: number | null; interest_pct: number | null; daily_use: number }): number | null {
  const { order_cost: s, unit_price_inr: p, interest_pct: i, daily_use: d } = input;
  if (s === null || p === null || i === null || !(s > 0) || !(p > 0) || !(i > 0) || !(d > 0)) return null;
  const holdingPerDay = p * (i / 100) / 365;
  const days = Math.sqrt((2 * s) / (d * holdingPerDay));
  return Math.min(MAX_CYCLE_DAYS, Math.max(MIN_CYCLE_DAYS, Math.round(days)));
}

/** Average landed cost of one order (per GRN) for a vendor + material; null = no history. */
export function averageOrderCost(rows: ReadonlyArray<{ total_cost: number }>): number | null {
  const valid = rows.filter((r) => Number.isFinite(r.total_cost) && r.total_cost > 0);
  return valid.length === 0 ? null : Math.round((valid.reduce((s, r) => s + r.total_cost, 0) / valid.length) * 100) / 100;
}
