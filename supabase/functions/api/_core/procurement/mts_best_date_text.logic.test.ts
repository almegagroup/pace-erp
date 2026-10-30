function assertEquals(a: unknown, b: unknown) { if (a !== b) throw new Error(`${a} !== ${b}`); }
import { bestDateText } from "./mts_best_date_text.logic.ts";

const base = { current_eta: "2026-12-08", best_eta: "2026-12-15", shift_days: 7, not_needed_in_plan: false, plan_end: "2027-01-31", best_port_eta: null, talk_to_vendor: false };

Deno.test("later date: must land by, can wait N days", () => {
  assertEquals(bestDateText(base), "Must land at plant by 2026-12-15 (can wait 7 d after the recorded date 2026-12-08)");
});
Deno.test("import shows the port date and talk-to-vendor prefix", () => {
  assertEquals(bestDateText({ ...base, best_port_eta: "2026-12-11", talk_to_vendor: true }), "Talk to the vendor: Must land at plant by 2026-12-15 · at port by 2026-12-11 (can wait 7 d after the recorded date 2026-12-08)");
});
Deno.test("earlier date says how much earlier", () => {
  assertEquals(bestDateText({ ...base, best_eta: "2026-11-20", shift_days: -18 }), "Must land at plant by 2026-11-20 (needed 18 d before the recorded date 2026-12-08)");
});
Deno.test("not needed inside the plan says why: cover days and the excess left", () => {
  assertEquals(
    bestDateText({ ...base, not_needed_in_plan: true, cover: { plan_days: 96, left_with: 92600, left_without: 68600, avg_daily_use: 1478, uom: "KG" } }),
    "Not needed inside the PO21 plan (2027-01-31): stock already covers the whole plan (96 days). When the plan ends 92,600 KG is still left over (68,600 KG even without this lot, ≈ 46 more days at the plan's average use). The plan has no use after that, so no ETA is set now (judged with every other order arriving as planned); schedule it when PO21 is extended.",
  );
});

import { bestDateWhy } from "./mts_best_date_text.logic.ts";
Deno.test("why: the level, its Min / Max, the pool at its top-up, and the day it falls below Critical", () => {
  const t = bestDateWhy({
    current_eta: "2026-11-12", best_eta: "2026-12-20", shift_days: 38, uom: "KG", vendor_message: null,
    binding: { day: "2026-12-21", min_day: "2026-11-29", level_label: "MHEC", cover_days: 14.6, min_days: 30, critical_days: 15, desired_days: 60, topup: { day: "2026-11-29", wanted: 45339, shortfall: 22800, pool_before: 23300 } },
  });
  assertEquals(t, "Can wait until 2026-12-20 (38 d after the recorded date 2026-11-12): without it MHEC (Min 30 d / Max 60 d) is below its Min from 2026-11-29 (at its 2026-11-29 top-up it asked the pool for 45,339 KG, the pool held 23,300 KG, short by 22,800 KG) and falls below its Critical (15 d) on 2026-12-21, down to 14 d of cover.");
});

import { ifAbsentText, togetherText } from "./mts_best_date_text.logic.ts";
Deno.test("if-absent: one line per neighbouring order, a DEADLINE for this order, never 'both are not needed'", () => {
  const t = ifAbsentText([
    { reference: "PO TS-0133", other_eta: "2026-12-24", best_eta: "2027-01-08", shift_days: 31, not_needed_in_plan: false, binding_day: "2027-01-09" },
    { reference: "PO G-0124", other_eta: "2026-12-08", best_eta: null, shift_days: 0, not_needed_in_plan: true, binding_day: null },
  ], "2026-12-08");
  assertEquals(t, "If PO TS-0133 (2026-12-24) does not come: this order must land at plant by 2027-01-08 at the latest, else a level falls below Critical (31 d after its recorded date 2026-12-08) (judged alone, other orders on their recorded dates).\nIf PO G-0124 (2026-12-08) does not come: this order is still not needed inside the plan (judged alone, other orders on their recorded dates).");
});
Deno.test("overdue piece: never 'can wait' / 'postpone' - says overdue and no shipment recorded", () => {
  const b2 = { current_eta: "2026-10-24", best_eta: "2026-10-29", shift_days: 5, not_needed_in_plan: false, plan_end: null, best_port_eta: "2026-10-25", talk_to_vendor: true, overdue_days: 5 };
  assertEquals(bestDateText(b2), "Talk to the vendor: Must land at plant by 2026-10-29 · at port by 2026-10-25 (recorded date 2026-10-24 is 5 d overdue, no shipment recorded)");
  const w = bestDateWhy({ current_eta: "2026-10-24", best_eta: "2026-10-29", shift_days: 5, uom: "KG", vendor_message: null, binding: null, overdue_days: 5 });
  assertEquals(w.includes("has passed (5 d overdue)") && !w.includes("Can wait"), true);
  assertEquals(ifAbsentText([{ reference: "PO X", other_eta: "2026-11-01", best_eta: "2026-11-27", shift_days: 34, not_needed_in_plan: false, binding_day: null }], "2026-10-24", 5).includes("already passed (5 d overdue)"), true);
});
Deno.test("together: extra buying and level-days when everything moves at once", () => {
  assertEquals(
    togetherText({ extra_buy_qty: 10000, below_min_days_now: 1, below_min_days_moved: 7, critical_days_now: 0, critical_days_moved: 0, uom: "KG" }),
    "If ALL not-yet-shipped orders move together to their advised dates: 10,000 KG more has to be bought, no level goes below Critical, level-days below Min 1 → 7. Each date is judged alone; moving several at once costs this.",
  );
});

import { moveCostText } from "./mts_best_date_text.logic.ts";
Deno.test("cost against Min: extra days below Min and the lowest cover, Critical still protected (owner 2026-10-30)", () => {
  assertEquals(
    moveCostText({ below_min_days_now: 0, below_min_days_moved: 9, lowest_cover_days_moved: 21.4, min_days: 30, critical_days: 20, level_label: "Exclusive — GABROSA M700" }, "2027-01-08"),
    "Cost against Min: landing on 2027-01-08 leaves Exclusive — GABROSA M700 below its Min for 9 more day(s) than now (0 → 9 days), and its cover sinks to 21 d (Min 30 d, Critical 20 d). The advised date protects Critical, not the Min.",
  );
  assertEquals(moveCostText({ below_min_days_now: 5, below_min_days_moved: 5, lowest_cover_days_moved: null, min_days: null, critical_days: null }, "2027-01-08"), "Landing on 2027-01-08 adds no day below A level's Min.");
  const w = bestDateWhy({ current_eta: "2026-12-08", best_eta: "2027-01-08", shift_days: 31, uom: "KG", vendor_message: null, binding: null, move_cost: { below_min_days_now: 0, below_min_days_moved: 9, lowest_cover_days_moved: 21, min_days: 30, critical_days: 20, level_label: "G" } });
  assertEquals(w.includes("Cost against Min"), true);
});
