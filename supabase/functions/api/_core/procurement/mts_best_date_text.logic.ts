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
  /** Days the recorded plant date is already in the past while nothing is shipped (owner 2026-10-29). */
  overdue_days?: number | null;
  /** Owner 2026-10-30: the piece is a Sub-CSN share; moving it moves the other companies' shares too. */
  shared_note?: string | null;
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
  if (i.shared_note) return `Latest for THIS company: plant by ${i.best_eta}${port}. Shared shipment (${i.shared_note}): a date change moves every share equally. Take the EARLIEST of all the companies' dates; never postpone on this company's date alone.`;
  const vendor = i.talk_to_vendor ? "Talk to the vendor: " : "";
  // An overdue piece is not "postponed": its recorded date has already passed with no shipment recorded.
  if (i.overdue_days && i.overdue_days > 0) return `${vendor}Must land at plant by ${i.best_eta}${port} (recorded date ${i.current_eta ?? "?"} is ${i.overdue_days} d overdue, no shipment recorded)`;
  if (i.shift_days === 0) return `${vendor}Date is right: must land at plant by ${i.best_eta}${port}`.trim();
  return i.shift_days > 0
    ? `${vendor}Must land at plant by ${i.best_eta}${port} (can wait ${i.shift_days} d after the recorded date ${i.current_eta ?? "?"})`
    : `${vendor}Must land at plant by ${i.best_eta}${port} (needed ${-i.shift_days} d before the recorded date ${i.current_eta ?? "?"})`;
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
  /** Set when the date was pulled back because several orders moving together would leave a level below Critical. */
  joint_note?: string | null;
  /** Days the recorded plant date is already in the past while nothing is shipped. */
  overdue_days?: number | null;
  /** Owner 2026-10-30: the piece is a Sub-CSN share; moving it moves the other companies' shares too. */
  shared_note?: string | null;
  /** Owner 2026-10-30: the cost of the advised date against the level's Min (Target): extra days below Min and the lowest cover reached. */
  critical_latest_eta?: string | null;
  move_cost?: { below_min_days_now: number; below_min_days_moved: number; lowest_cover_days_moved: number | null; min_days: number | null; critical_days: number | null; level_label?: string | null } | null;
};

/**
 * Owner 2026-10-30: the advised date protects the MIN. This sentence names the looser limit: the absolute latest date that still keeps the
 * level above its CRITICAL, and what that would cost against the Min (extra days below Min, lowest cover).
 */
export function moveCostText(c: NonNullable<BestDateWhyInput["move_cost"]>, criticalEta: string): string {
  const who = c.level_label ? `${c.level_label}` : "a level";
  const extra = c.below_min_days_moved - c.below_min_days_now;
  if (extra <= 0) return `Absolute latest (Critical limit): ${criticalEta}; it adds no day below the Min.`;
  const low = c.lowest_cover_days_moved !== null
    ? `, with its cover down to ${Math.floor(c.lowest_cover_days_moved)} d${c.min_days !== null ? ` (Min ${c.min_days} d${c.critical_days !== null ? `, Critical ${c.critical_days} d` : ""})` : ""}`
    : "";
  return `Absolute latest (Critical limit): ${criticalEta}. Landing that late leaves ${who} below its Min for ${extra} more day(s) than now (${c.below_min_days_now} → ${c.below_min_days_moved} days)${low}.`;
}

/**
 * Plain reason for the advised date, in the PDF's terms: without this lot the level reaches its Min and the pool cannot refill it
 * (what it asked for, what the pool held), the level keeps running down, and falls below its Critical on a day — the lot must land before.
 */
export function bestDateWhy(i: BestDateWhyInput): string {
  const b = i.binding;
  if (!b && i.joint_note) return i.vendor_message ? `${i.joint_note} ${i.vendor_message}` : i.joint_note;
  const atMin = !!b && b.day === b.min_day;
  const level = b && atMin
    ? `without it ${b.level_label} (Min ${b.min_days} d${b.desired_days !== null ? ` / Max ${b.desired_days} d` : ""}) falls below its Min on ${b.day}${b.topup ? ` (at its ${b.topup.day} top-up it asked the pool for ${fmt(b.topup.wanted)} ${i.uom}, the pool held ${fmt(b.topup.pool_before)} ${i.uom}, short by ${fmt(b.topup.shortfall)} ${i.uom})` : ""}, down to ${Math.floor(b.cover_days)} d of cover${b.critical_days !== null ? ` (Critical ${b.critical_days} d)` : ""}`
    : b
    ? `without it ${b.level_label} (Min ${b.min_days} d${b.desired_days !== null ? ` / Max ${b.desired_days} d` : ""}) is below its Min from ${b.min_day}${b.topup ? ` (at its ${b.topup.day} top-up it asked the pool for ${fmt(b.topup.wanted)} ${i.uom}, the pool held ${fmt(b.topup.pool_before)} ${i.uom}, short by ${fmt(b.topup.shortfall)} ${i.uom})` : ""} and falls below its Critical${b.critical_days !== null ? ` (${b.critical_days} d)` : ""} on ${b.day}, down to ${Math.floor(b.cover_days)} d of cover`
    : "without it stock runs out or a group's demand is not served";
  const lead = i.shared_note
    ? `Latest safe date for THIS company: ${i.best_eta} (recorded ${i.current_eta ?? "?"}): ${level}. Shared shipment (${i.shared_note}): any date change moves all shares together, so use the earliest of the companies' dates and do not postpone on this one alone.`
    : i.overdue_days && i.overdue_days > 0
    ? `The recorded plant date ${i.current_eta ?? "?"} has passed (${i.overdue_days} d overdue) and no shipment is recorded. It is needed at plant by ${i.best_eta}: ${level}.`
    : i.shift_days < 0
      ? `The recorded date ${i.current_eta ?? "?"} is too late: ${level}. It must land by ${i.best_eta} (${-i.shift_days} d earlier).`
      : i.shift_days > 0
        ? `Can wait until ${i.best_eta} (${i.shift_days} d after the recorded date ${i.current_eta ?? "?"}): ${level}.`
        : `${i.current_eta ?? i.best_eta} is the latest safe date: ${level}.`;
  const crit = i.critical_latest_eta && i.critical_latest_eta > i.best_eta ? i.critical_latest_eta : null;
  const withCost = crit && i.move_cost && !(i.overdue_days && i.overdue_days > 0) ? `${lead} ${moveCostText(i.move_cost, crit)}` : lead;
  const withJoint = i.joint_note ? `${withCost} ${i.joint_note}` : withCost;
  return i.vendor_message && !i.shared_note ? `${withJoint} ${i.vendor_message}` : withJoint;
}

export type IfAbsentInput = { reference: string; other_eta: string; best_eta: string | null; shift_days: number; not_needed_in_plan: boolean; binding_day: string | null };

/**
 * "If the other order does not come": the DEADLINE for THIS order then (owner 2026-10-29: never "both are not needed").
 * Judged alone with every other order on its recorded date - so it differs from the main date, which also protects against
 * several orders being late together.
 */
export function ifAbsentText(list: readonly IfAbsentInput[], currentEta: string | null, overdueDays: number | null = null): string {
  const rec = currentEta ?? "?";
  const overdue = overdueDays && overdueDays > 0 ? ` Its recorded date has already passed (${overdueDays} d overdue).` : "";
  const alone = " (judged alone, other orders on their recorded dates)";
  return list.map((x) => {
    const other = `${x.reference} (${x.other_eta})`;
    if (x.not_needed_in_plan) return `If ${other} does not come: this order is still not needed inside the plan${alone}.`;
    if (!x.best_eta) return `If ${other} does not come: no date can be advised.`;
    if (x.shift_days === 0) return `If ${other} does not come: this order must land at plant by its recorded date ${rec}${alone}.${overdue}`;
    return x.shift_days > 0
      ? `If ${other} does not come: this order must land at plant by ${x.best_eta} at the latest, else a level falls below its Min (${x.shift_days} d after its recorded date ${rec})${alone}.${overdue}`
      : `If ${other} does not come: this order must land at plant by ${x.best_eta} (${-x.shift_days} d before its recorded date ${rec})${alone}.${overdue}`;
  }).join("\n");
}

export type TogetherInput = { extra_buy_qty: number; below_min_days_now: number; below_min_days_moved: number; critical_days_now: number; critical_days_moved: number; uom: string };

/**
 * One line for the family (owner 2026-10-30): the recommended schedule is the set of dates in "What to do" (an order is either moved to its date or kept).
 * This says what applying ALL of them together costs.
 */
export function togetherText(t: TogetherInput): string {
  const buy = t.extra_buy_qty > 0.5 ? `${fmt(t.extra_buy_qty)} ${t.uom} more has to be bought` : t.extra_buy_qty < -0.5 ? `${fmt(-t.extra_buy_qty)} ${t.uom} less has to be bought` : "no extra buying";
  const min = t.below_min_days_moved > t.below_min_days_now ? `${t.below_min_days_moved - t.below_min_days_now} more level-days below Min` : t.below_min_days_moved < t.below_min_days_now ? `${t.below_min_days_now - t.below_min_days_moved} fewer level-days below Min` : "no extra day below Min";
  const critical = t.critical_days_moved > t.critical_days_now ? `, ${t.critical_days_moved - t.critical_days_now} more level-days below Critical` : "";
  return `RECOMMENDED SCHEDULE for this family = the "What to do" date of each order together (an order is moved to its date, or kept). Applying ALL of them: ${buy}, ${min}${critical}.`;
}

export type ActionInput = {
  not_needed_in_plan: boolean;
  best_eta: string;
  current_eta: string | null;
  shift_days: number;
  overdue_days?: number | null;
  /** Days since the recorded ETD passed with no shipment recorded (null = ETD not passed or unknown). */
  etd_passed_days?: number | null;
  shared_note?: string | null;
};

/**
 * Owner 2026-10-30: ONE plain instruction per not-yet-shipped order for management: what to do now and by when.
 * Everything else (levels, Min / Critical, the other order's effect) stays in the detail columns.
 */
export function actionText(i: ActionInput): string {
  if (i.not_needed_in_plan) return "NOT NEEDED inside the plan. No date.";
  const rec = i.current_eta ?? "?";
  const chase = i.overdue_days && i.overdue_days > 0
    ? `OVERDUE ${i.overdue_days} d (recorded ${rec}, no shipment recorded). CHASE THE VENDOR.`
    : i.etd_passed_days && i.etd_passed_days > 0
      ? `NOT SHIPPED: the ETD passed ${i.etd_passed_days} d ago. CHASE THE VENDOR.`
      : null;
  if (i.shared_note) return `${chase ? `${chase} ` : ""}SHARED SHIPMENT: needed at plant by ${i.best_eta} for THIS company; ${i.shared_note}. Use the EARLIEST of all the companies' dates.`;
  if (chase) return `${chase} Needed at plant by ${i.best_eta}.`;
  if (i.shift_days < 0) return `TOO LATE: must be at plant by ${i.best_eta} (${-i.shift_days} d before recorded ${rec}).`;
  if (i.shift_days === 0) return `ON TIME: keep ${rec}.`;
  return `CAN WAIT until ${i.best_eta} (room of ${i.shift_days} d after recorded ${rec}). Needed by ${i.best_eta}.`;
}
