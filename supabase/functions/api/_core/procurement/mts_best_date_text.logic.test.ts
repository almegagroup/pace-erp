function assertEquals(a: unknown, b: unknown) { if (a !== b) throw new Error(`${a} !== ${b}`); }
import { bestDateText } from "./mts_best_date_text.logic.ts";

const base = { current_eta: "2026-12-08", best_eta: "2026-12-15", shift_days: 7, not_needed_in_plan: false, plan_end: "2027-01-31", best_port_eta: null, talk_to_vendor: false };

Deno.test("later date: must land by, can wait N days", () => {
  assertEquals(bestDateText(base), "Must land at plant by 2026-12-15 (can wait 7 d)");
});
Deno.test("import shows the port date and talk-to-vendor prefix", () => {
  assertEquals(bestDateText({ ...base, best_port_eta: "2026-12-11", talk_to_vendor: true }), "Talk to the vendor: Must land at plant by 2026-12-15 · at port by 2026-12-11 (can wait 7 d)");
});
Deno.test("earlier date says how much earlier", () => {
  assertEquals(bestDateText({ ...base, best_eta: "2026-11-20", shift_days: -18 }), "Must land at plant by 2026-11-20 (needed 18 d earlier than now)");
});
Deno.test("not needed inside the plan names the plan end", () => {
  assertEquals(bestDateText({ ...base, not_needed_in_plan: true }), "Not needed before the PO21 plan ends (2027-01-31); the current date is fine.");
});
