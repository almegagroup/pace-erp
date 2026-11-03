import {
  DISPATCH_BACKLOG_GRACE_PERIOD_END,
  canUseDependentDepotBacklogTallyDate,
  canUseFgStoBacklogTallyDate,
  isDispatchBacklogGracePeriodOpen,
} from "./dispatchBacklogWindow.ts";

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: ${actual}`);
}

Deno.test("one shared backlog window governs VDC, Dependent Depot, and FG STO dispatches", () => {
  equal(DISPATCH_BACKLOG_GRACE_PERIOD_END, "2026-11-15", "published cutoff");
  equal(isDispatchBacklogGracePeriodOpen("2026-11-15"), true, "cutoff day remains available");
  equal(isDispatchBacklogGracePeriodOpen("2026-11-16"), false, "Today-2 rule resumes the next day");
  equal(canUseDependentDepotBacklogTallyDate("DEPENDENT_DEPOT", "2026-11-15"), true, "Depot follows the shared window");
  equal(canUseDependentDepotBacklogTallyDate(" dependent_depot ", "2026-11-15"), true, "dispatch type is normalized");
  equal(canUseDependentDepotBacklogTallyDate("DEPENDENT_DEPOT", "2026-11-16"), false, "Depot window also expires");
  equal(canUseDependentDepotBacklogTallyDate("DEPENDENT_DIRECT", "2026-11-15"), false, "other dispatch types remain unchanged");
  equal(canUseDependentDepotBacklogTallyDate(null, "2026-11-15"), false, "missing type never receives the exception");
  equal(canUseFgStoBacklogTallyDate(true, "2026-11-15"), true, "FG STO follows the shared window");
  equal(canUseFgStoBacklogTallyDate(true, "2026-11-16"), false, "FG STO window also expires");
  equal(canUseFgStoBacklogTallyDate(false, "2026-11-15"), false, "ordinary STO remains unchanged");
});
