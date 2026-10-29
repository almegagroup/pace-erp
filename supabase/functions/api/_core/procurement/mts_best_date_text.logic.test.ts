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
Deno.test("not needed inside the plan says why: cover days and the excess left", () => {
  assertEquals(
    bestDateText({ ...base, not_needed_in_plan: true, cover: { plan_days: 96, left_with: 92600, left_without: 68600, avg_daily_use: 1478, uom: "KG" } }),
    "Not needed inside the PO21 plan (2027-01-31): stock already covers the whole plan (96 days). When the plan ends 92,600 KG is still left over (68,600 KG even without this lot, ≈ 46 more days at the plan's average use). The plan has no use after that, so no ETA is set now; schedule it when PO21 is extended.",
  );
});
