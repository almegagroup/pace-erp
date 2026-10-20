/*
 * PO22 planning cost inputs — pure rules (owner decisions D10/D11, 2026-10-19).
 * No database or network access here; see mts_planning_cost.handlers.ts.
 */

export type FxRateRow = {
  currency_code: string;
  rate_date: string;
  inr_per_unit: number;
  source: "AUTO" | "MANUAL";
};

export type FxPick = {
  inr_per_unit: number;
  rate_date: string;
  source: "AUTO" | "MANUAL" | "BOE" | "BASE";
  /** true when the rate is from an earlier date than asked (holiday / failed fetch). */
  stale: boolean;
};

/**
 * Rate for `currency` on `day` from stored rows: on the same date MANUAL beats AUTO;
 * otherwise the latest earlier date (MANUAL first) is used and flagged stale. INR = 1.
 */
export function pickFxRate(rows: readonly FxRateRow[], currency: string, day: string): FxPick | null {
  const code = currency.toUpperCase();
  if (code === "INR") return { inr_per_unit: 1, rate_date: day, source: "BASE", stale: false };
  const candidates = rows
    .filter((row) => row.currency_code.toUpperCase() === code && row.rate_date <= day && row.inr_per_unit > 0)
    .sort((a, b) => b.rate_date.localeCompare(a.rate_date) || (a.source === "MANUAL" ? -1 : 1) - (b.source === "MANUAL" ? -1 : 1));
  const best = candidates[0];
  if (!best) return null;
  return { inr_per_unit: Number(best.inr_per_unit), rate_date: best.rate_date, source: best.source, stale: best.rate_date < day };
}

/**
 * D11 precedence for an existing import CSN: BOE rate on the CSN > table rate on the BOE
 * date > today's table rate (BOE date blank). A proposed buy passes boeDate = null.
 */
export function pickCsnFxRate(
  rows: readonly FxRateRow[],
  currency: string,
  today: string,
  boeDate: string | null,
  boeExchangeRate: number | null,
): FxPick | null {
  if (currency.toUpperCase() === "INR") return { inr_per_unit: 1, rate_date: today, source: "BASE", stale: false };
  if (boeExchangeRate !== null && boeExchangeRate > 0) {
    return { inr_per_unit: boeExchangeRate, rate_date: boeDate ?? today, source: "BOE", stale: false };
  }
  return pickFxRate(rows, currency, boeDate ?? today);
}

export type InterestRow = { effective_from: string; interest_pct_per_year: number };

/** Company interest % on `day`: row with the latest effective_from <= day; null = not set. */
export function interestPctAt(rows: readonly InterestRow[], day: string): number | null {
  let best: InterestRow | null = null;
  for (const row of rows) if (row.effective_from <= day && (!best || row.effective_from > best.effective_from)) best = row;
  return best ? Number(best.interest_pct_per_year) : null;
}

/** D11 financing cost: value × % per year × days / 365 (days from cash-out to cash-in, never negative). */
export function financingCost(valueInr: number, pctPerYear: number | null, days: number): number | null {
  if (pctPerYear === null || !Number.isFinite(valueInr)) return null;
  return Math.round(valueInr * (pctPerYear / 100) * (Math.max(0, days) / 365) * 100) / 100;
}

/** Parses the provider reply `{ date, rates: { INR } }`; null when unusable. */
export function parseProviderRate(json: unknown): { rate: number; date: string } | null {
  if (!json || typeof json !== "object") return null;
  const record = json as { date?: unknown; rates?: Record<string, unknown> };
  const rate = Number(record.rates?.INR);
  const date = String(record.date ?? "");
  if (!Number.isFinite(rate) || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { rate, date };
}
