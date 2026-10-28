import { DEFAULT_RESCHEDULE_WINDOWS, rescheduleVerdict, resolveRescheduleWindows } from "./mts_reschedule_window.logic.ts";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const today = "2026-10-28";
const W = DEFAULT_RESCHEDULE_WINDOWS;

Deno.test("owner 2026-10-28: windows come from settings, defaults only as fallback", () => {
  assert(W.import_min_days === 15 && W.domestic_min_days === 7, "defaults 15 / 7");
  const own = resolveRescheduleWindows({ import_min_days: 20, domestic_min_days: null });
  assert(own.import_min_days === 20 && own.domestic_min_days === 7, "a saved value wins, a blank falls back");
  assert(resolveRescheduleWindows({ import_min_days: -3 }).import_min_days === 15, "a negative value is ignored");
});

Deno.test("import: ETD far enough away on both dates -> reschedule", () => {
  // CSN 3000000239: ETD 18 Nov (21 days away), plant 24 Dec, route 36 days; move 10 days later -> new ETD 28 Nov (31 days away)
  const v = rescheduleVerdict({ today, route: "IMPORT", routeDays: 36, currentEta: "2026-12-24", proposedEta: "2027-01-03", currentEtd: "2026-11-18", windows: W });
  assert(v.state === "RESCHEDULE" && v.days_to_current_etd === 21 && v.days_to_proposed_etd === 31, JSON.stringify(v));
});

Deno.test("import: current ETD only 4 days away -> talk to the vendor (CSN 3000000329)", () => {
  const v = rescheduleVerdict({ today, route: "IMPORT", routeDays: 37, currentEta: "2026-12-08", proposedEta: "2026-12-31", currentEtd: "2026-11-01", windows: W });
  assert(v.state === "TALK_TO_VENDOR" && v.days_to_current_etd === 4, JSON.stringify(v));
  assert(v.message.includes("Talk to the vendor"), v.message);
});

Deno.test("exactly the window is NOT enough (more than 15 needed)", () => {
  const v = rescheduleVerdict({ today, route: "IMPORT", routeDays: 30, currentEta: "2026-12-12", proposedEta: "2026-12-20", currentEtd: "2026-11-12", windows: W });
  assert(v.days_to_current_etd === 15 && v.state === "TALK_TO_VENDOR", JSON.stringify(v));
});

Deno.test("import: preponing so that the new ETD falls inside the window -> talk to the vendor", () => {
  // current ETD 40 days away is fine, but a prepone of 30 days puts the new ETD 10 days away
  const v = rescheduleVerdict({ today, route: "IMPORT", routeDays: 36, currentEta: "2027-01-15", proposedEta: "2026-12-16", currentEtd: "2026-12-08", windows: W });
  assert(v.state === "TALK_TO_VENDOR" && (v.days_to_proposed_etd ?? 99) <= 15, JSON.stringify(v));
  assert(v.message.includes("new ETD"), v.message);
});

Deno.test("domestic uses the 7-day window and an ETD already in the past can never be moved", () => {
  const ok = rescheduleVerdict({ today, route: "DOMESTIC", routeDays: 5, currentEta: "2026-11-20", proposedEta: "2026-11-30", windows: W });
  assert(ok.state === "RESCHEDULE", JSON.stringify(ok));
  const past = rescheduleVerdict({ today, route: "DOMESTIC", routeDays: 5, currentEta: "2026-11-01", proposedEta: "2026-11-10", currentEtd: "2026-10-24", windows: W });
  assert(past.state === "TALK_TO_VENDOR" && (past.days_to_current_etd ?? 0) < 0, JSON.stringify(past));
});

Deno.test("no shift, unknown route or missing route days are said plainly", () => {
  assert(rescheduleVerdict({ today, route: "IMPORT", routeDays: 36, currentEta: "2026-12-24", proposedEta: "2026-12-24", windows: W }).state === "NO_CHANGE", "no change");
  assert(rescheduleVerdict({ today, route: null, routeDays: 36, currentEta: "2026-12-24", proposedEta: "2027-01-03", windows: W }).state === "UNKNOWN", "route unknown");
  assert(rescheduleVerdict({ today, route: "IMPORT", routeDays: null, currentEta: "2026-12-24", proposedEta: "2027-01-03", windows: W }).state === "UNKNOWN", "route days unknown");
});

Deno.test("a configured window changes the decision (nothing hard-coded)", () => {
  const args = { today, route: "IMPORT" as const, routeDays: 36, currentEta: "2026-12-24", proposedEta: "2027-01-03", currentEtd: "2026-11-18" };
  assert(rescheduleVerdict({ ...args, windows: { import_min_days: 15, domestic_min_days: 7 } }).state === "RESCHEDULE", "15 -> reschedule");
  assert(rescheduleVerdict({ ...args, windows: { import_min_days: 25, domestic_min_days: 7 } }).state === "TALK_TO_VENDOR", "25 -> talk to the vendor");
});
