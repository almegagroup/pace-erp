import { planningShareKey } from "./mts_planning_share.logic.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const base = { companyId: "c1", planMonth: "2026-11-01", asOf: "2026-11-16", demandAt: null, today: "2026-11-16" };

Deno.test("planning share key: identical calls share, simulations never do, lot order does not matter", () => {
  const a = planningShareKey({ ...base, manualLots: [{ material_id: "m1", plant_eta: "2026-12-01", qty_base: 5 }, { material_id: "m2", plant_eta: "2026-12-02", qty_base: 7 }] });
  const b = planningShareKey({ ...base, manualLots: [{ material_id: "m2", plant_eta: "2026-12-02", qty_base: 7 }, { material_id: "m1", plant_eta: "2026-12-01", qty_base: 5 }] });
  assert(a !== null && a === b, "same lots in another order = same key");
  assert(planningShareKey({ ...base, asOf: "2026-11-17" }) !== planningShareKey(base), "another day = another key");
  assert(planningShareKey({ ...base, companyId: "c2" }) !== planningShareKey(base), "another company = another key");
  assert(planningShareKey({ ...base, scheduleChecks: true }) !== planningShareKey(base), "schedule checks change the result");
  assert(planningShareKey({ ...base, rescheduleOverrides: new Map([["k", "2026-12-01"]]) }) === null, "a what-if is never shared");
  assert(planningShareKey({ ...base, policyOverrides: new Map() }) === null, "a what-if is never shared");
});
