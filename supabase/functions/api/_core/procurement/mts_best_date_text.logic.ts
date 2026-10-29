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
};

export function bestDateText(i: BestDateInput): string {
  if (i.not_needed_in_plan) {
    return `Not needed before the PO21 plan ends${i.plan_end ? ` (${i.plan_end})` : ""}; the current date is fine.`;
  }
  const port = i.best_port_eta ? ` · at port by ${i.best_port_eta}` : "";
  const vendor = i.talk_to_vendor ? "Talk to the vendor: " : "";
  if (i.shift_days === 0) return `${vendor}Date is right: must land at plant by ${i.best_eta}${port}`.trim();
  return i.shift_days > 0
    ? `${vendor}Must land at plant by ${i.best_eta}${port} (can wait ${i.shift_days} d)`
    : `${vendor}Must land at plant by ${i.best_eta}${port} (needed ${-i.shift_days} d earlier than now)`;
}
