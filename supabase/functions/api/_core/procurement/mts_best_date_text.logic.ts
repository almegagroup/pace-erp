/*
 * Owner 2026-10-29: plain words for the "Engine best date" of a consignment that has not shipped yet.
 * The date is the LATEST plant date at which the owner's waterfall still fills every level (PDF "How PO22 plans RM purchases").
 * Pure: no database call.
 */
export type BestDateInput = {
  current_eta: string | null;
  best_eta: string;
  shift_days: number;
  not_needed_in_plan: boolean;
  plan_end: string | null;
  /** IMPORT only: best plant date minus the route's port-to-plant days. */
  best_port_eta: string | null;
  talk_to_vendor: boolean;
  /** Only when not_needed_in_plan; quantities already in the display unit. */
  cover?: { plan_days: number; left_with: number; left_without: number | null; avg_daily_use: number; uom: string } | null;
};
const fmt = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

export function bestDateText(i: BestDateInput): string {
  if (i.not_needed_in_plan) {
    const end = i.plan_end ? ` (${i.plan_end})` : "";
    const c = i.cover;
    if (!c) return `Not needed before the PO21 plan ends${end}: no ETA is set now.`;
    const base = c.left_without ?? c.left_with;
    const extra = c.avg_daily_use > 0 ? ` ≈ ${Math.floor(base / c.avg_daily_use)} more days at the plan's average use` : "";
    const without = c.left_without !== null ? ` (${fmt(c.left_without)} ${c.uom} even without this lot,${extra})` : "";
    return `Not needed inside the PO21 plan${end}: stock already covers the whole plan (${c.plan_days} days). When the plan ends ${fmt(c.left_with)} ${c.uom} is still left over${without}. The plan has no use after that, so no ETA is set now (judged with every other order arriving as planned); schedule it when PO21 is extended.`;
  }
  const port = i.best_port_eta ? ` · at port by ${i.best_port_eta}` : "";
  const vendor = i.talk_to_vendor ? "Talk to the vendor: " : "";
  if (i.shift_days === 0) return `${vendor}Date is right: must land at plant by ${i.best_eta}${port}`.trim();
  return i.shift_days > 0
    ? `${vendor}Must land at plant by ${i.best_eta}${port} (can wait ${i.shift_days} d)`
    : `${vendor}Must land at plant by ${i.best_eta}${port} (needed ${-i.shift_days} d earlier than now)`;
}

export type BestDateWhyInput = {
  current_eta: string | null;
  best_eta: string;
  shift_days: number;
  binding: {
    day: string; min_day: string; level_label: string; cover_days: number; min_days: number; critical_days: number | null; desired_days: number | null;
    topup: { day: string; wanted: number; shortfall: number; pool_before: number } | null;
  } | null;
  uom: string;
  /** The ETD window verdict (docs §10), when the vendor can no longer move the shipment. */
  vendor_message: string | null;
};

/**
 * Plain reason for the advised date, in the PDF's terms: without this lot the level reaches its Min and the pool cannot refill it
 * (what it asked for, what the pool held), the level keeps running down, and falls below its Critical on a day — the lot must land before.
 */
export function bestDateWhy(i: BestDateWhyInput): string {
  const b = i.binding;
  const level = b
    ? `without it ${b.level_label} (Min ${b.min_days} d${b.desired_days !== null ? ` / Max ${b.desired_days} d` : ""}) is below its Min from ${b.min_day}${b.topup ? ` (at its ${b.topup.day} top-up it asked the pool for ${fmt(b.topup.wanted)} ${i.uom}, the pool held ${fmt(b.topup.pool_before)} ${i.uom}, short by ${fmt(b.topup.shortfall)} ${i.uom})` : ""} and falls below its Critical${b.critical_days !== null ? ` (${b.critical_days} d)` : ""} on ${b.day}, down to ${Math.floor(b.cover_days)} d of cover`
    : "without it stock runs out or a group's demand is not served";
  const lead = i.shift_days < 0
    ? `Now ${i.current_eta ?? "?"} is too late: ${level}. It must land by ${i.best_eta} (${-i.shift_days} d earlier).`
    : i.shift_days > 0
      ? `Can wait until ${i.best_eta} (${i.shift_days} d later than now): ${level}.`
      : `${i.current_eta ?? i.best_eta} is the latest safe date: ${level}.`;
  return i.vendor_message ? `${lead} ${i.vendor_message}` : lead;
}
