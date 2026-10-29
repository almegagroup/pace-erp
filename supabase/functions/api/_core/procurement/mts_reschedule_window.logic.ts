/*
 * PO22 reschedule feasibility window (owner 2026-10-28, docs/mts-planning/PO22-WATERFALL-OWNER-METHOD-2026-10-28.md §10).
 * Pure: no database call. Applies only to a consignment piece that has NOT been dispatched.
 *
 * The planner proposes a plant date. The vendor can still move the shipment only while its ETD is far enough away:
 *   IMPORT   — ETD - today must be MORE than `import_min_days`   (default 15)
 *   DOMESTIC — ETD - today must be MORE than `domestic_min_days` (default 7)
 * Both the CURRENT ETD and the PROPOSED ETD (= proposed plant date - route days; Booking Time is not included) are judged.
 * Otherwise the advice is "cannot be scheduled - talk to the vendor". The two windows are settings, never constants in the
 * decision: `DEFAULT_RESCHEDULE_WINDOWS` is only the fallback when a company has not set its own.
 */
export type RescheduleRoute = "IMPORT" | "DOMESTIC";
export type RescheduleWindows = { import_min_days: number; domestic_min_days: number };
export const DEFAULT_RESCHEDULE_WINDOWS: RescheduleWindows = { import_min_days: 15, domestic_min_days: 7 };

export type RescheduleVerdictState = "NO_CHANGE" | "RESCHEDULE" | "TALK_TO_VENDOR" | "UNKNOWN";
export type RescheduleVerdict = {
  state: RescheduleVerdictState;
  route: RescheduleRoute | null;
  window_days: number | null;
  current_etd: string | null;
  proposed_etd: string | null;
  days_to_current_etd: number | null;
  days_to_proposed_etd: number | null;
  shift_days: number | null;
  message: string;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number) => new Date(toMs(iso) + n * dayMs).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((toMs(a) - toMs(b)) / dayMs);

export function resolveRescheduleWindows(saved: Partial<Record<keyof RescheduleWindows, number | null | undefined>> | null | undefined): RescheduleWindows {
  const pick = (value: number | null | undefined, fallback: number) => (value !== null && value !== undefined && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback);
  return {
    import_min_days: pick(saved?.import_min_days, DEFAULT_RESCHEDULE_WINDOWS.import_min_days),
    domestic_min_days: pick(saved?.domestic_min_days, DEFAULT_RESCHEDULE_WINDOWS.domestic_min_days),
  };
}

export function rescheduleVerdict(args: {
  today: string;
  route: RescheduleRoute | null;
  /** Route time only (sail + clearance + inland, or transit), Booking Time excluded. */
  routeDays: number | null;
  currentEta: string | null;
  proposedEta: string | null;
  /** The CSN's own ETD when it has one; otherwise it is derived as current plant date - route days. */
  currentEtd?: string | null;
  windows: RescheduleWindows;
}): RescheduleVerdict {
  const empty = (state: RescheduleVerdictState, message: string, extra: Partial<RescheduleVerdict> = {}): RescheduleVerdict => ({
    state, route: args.route, window_days: null, current_etd: null, proposed_etd: null, days_to_current_etd: null, days_to_proposed_etd: null, shift_days: null, message, ...extra,
  });
  if (!args.proposedEta || !ISO.test(args.proposedEta) || !args.currentEta || !ISO.test(args.currentEta)) return empty("UNKNOWN", "No plant date to compare.");
  const shift = diffDays(args.proposedEta, args.currentEta);
  if (shift === 0) return empty("NO_CHANGE", "The current date is right.", { shift_days: 0 });
  if (!args.route) return empty("UNKNOWN", "Cannot tell import from domestic (no PO import type): cannot judge whether the vendor can still move it.", { shift_days: shift });
  if (args.routeDays === null || !Number.isFinite(args.routeDays) || args.routeDays < 0) {
    return empty("UNKNOWN", `No route time is configured for this vendor, so the ETD cannot be worked out. Ask the vendor.`, { shift_days: shift });
  }
  const windowDays = args.route === "IMPORT" ? args.windows.import_min_days : args.windows.domestic_min_days;
  const currentEtd = args.currentEtd && ISO.test(args.currentEtd) ? args.currentEtd : addDays(args.currentEta, -args.routeDays);
  const proposedEtd = addDays(args.proposedEta, -args.routeDays);
  const toCurrent = diffDays(currentEtd, args.today);
  const toProposed = diffDays(proposedEtd, args.today);
  const direction = shift > 0 ? `postpone by ${shift}` : `prepone by ${-shift}`;
  const base = { route: args.route, window_days: windowDays, current_etd: currentEtd, proposed_etd: proposedEtd, days_to_current_etd: toCurrent, days_to_proposed_etd: toProposed, shift_days: shift };
  const kind = args.route === "IMPORT" ? "import" : "domestic";
  if (toCurrent > windowDays && toProposed > windowDays) {
    return { state: "RESCHEDULE", ...base, message: `Reschedule: ${direction} day(s). ETD ${currentEtd} is ${toCurrent} day(s) away and the new ETD ${proposedEtd} is ${toProposed} day(s) away (${kind}: more than ${windowDays} needed).` };
  }
  if (toCurrent < 0) {
    // The shipment date has already passed and nothing is recorded as dispatched: this is not a reschedule, the goods are late.
    return { state: "TALK_TO_VENDOR", ...base, message: `ETD ${currentEtd} passed ${-toCurrent} day(s) ago and no shipment is recorded. Ask the vendor where the goods are and the real dispatch date, then update the CSN Tracker. The plan needs them at plant by ${args.proposedEta}.` };
  }
  const why = toCurrent <= windowDays
    ? `the current ETD ${currentEtd} is only ${toCurrent} day(s) away`
    : toProposed < 0
      ? `the ETD needed for the new date (${proposedEtd}) is already in the past`
      : `the new ETD ${proposedEtd} would be only ${toProposed} day(s) away`;
  return { state: "TALK_TO_VENDOR", ...base, message: `Cannot be scheduled: ${why} (${kind}: more than ${windowDays} needed). Talk to the vendor to see whether ${direction} day(s) is possible.` };
}
