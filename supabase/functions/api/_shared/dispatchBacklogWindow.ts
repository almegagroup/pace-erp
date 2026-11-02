/*
 * Shared temporary backlog window for physical dispatch completion.
 *
 * The original VDC/DD implementation established this owner-approved
 * schedule. DEPENDENT_DEPOT PGI and FG STO PGI use the same calendar policy
 * rather than carrying independently-maintained cutoffs.
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

// FG STO is an INTER_PLANT STO whose dispatched lines are all FG. The caller
// derives that classification from the STO and material records; this helper
// owns only the shared, time-boxed date policy.
export function canUseFgStoBacklogTallyDate(isFgSto: boolean, todayIso: string): boolean {
  return isFgSto && isDispatchBacklogGracePeriodOpen(todayIso);
}
