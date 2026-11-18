/**
 * Owner 2026-11-17: a report must prove itself on every download. Pure checks over one block's day table; any failure is
 * printed on the sheet instead of leaving the reader to find a contradiction.
 */
export type SelfCheckRow = {
  day: string;
  opening: number | null; arrivals: number | null; new_lot: number | null; use: number | null; closing: number | null;
};

const num = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? 0 : Number(v));

export function selfCheckBlock(rows: readonly SelfCheckRow[], lastRecordedDay: string | null): string[] {
  const issues: string[] = [];
  for (const r of rows) {
    // Every day: Closing = Opening + landed orders + counted new orders - use (rounded values, so a small tolerance).
    const expected = num(r.opening) + num(r.arrivals) + num(r.new_lot) - num(r.use);
    const tolerance = Math.max(1, Math.abs(num(r.closing)) * 0.001);
    if (r.closing !== null && Math.abs(expected - num(r.closing)) > tolerance) {
      issues.push(`${r.day}: Closing ${num(r.closing)} does not equal Opening + landed + new order - use (${Math.round(expected * 100) / 100})`);
    }
    // One plan: a new order counted inside the recorded orders breaks the rule that only the orders after them are counted.
    if (lastRecordedDay && num(r.new_lot) > 0 && r.day <= lastRecordedDay) {
      issues.push(`${r.day}: a new order is counted inside the recorded orders (last recorded ${lastRecordedDay})`);
    }
  }
  return issues;
}
