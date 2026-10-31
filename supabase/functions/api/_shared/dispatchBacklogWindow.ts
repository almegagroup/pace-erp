/*
 * Shared temporary backlog window for physical dispatch completion.
 *
 * The original VDC/DD implementation established this owner-approved
 * schedule. DEPENDENT_DEPOT PGI uses the same calendar policy rather than
 * carrying a second, independently-maintained cutoff.
 */
export const DISPATCH_BACKLOG_GRACE_PERIOD_END = "2026-11-15";

export function isDispatchBacklogGracePeriodOpen(todayIso: string): boolean {
  return todayIso <= DISPATCH_BACKLOG_GRACE_PERIOD_END;
}

export function canUseDependentDepotBacklogTallyDate(
  dispatchType: string | null | undefined,
  todayIso: string,
): boolean {
  return String(dispatchType ?? "").trim().toUpperCase() === "DEPENDENT_DEPOT"
    && isDispatchBacklogGracePeriodOpen(todayIso);
}
