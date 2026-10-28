import { buildStorePlan, type StorePlanInput, type StorePlanRecord } from "./mts_store_plan.logic.ts";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

const periods = [
  { key: "2026-10", label: "October 2026 (from 28)", from: "2026-10-28", to: "2026-10-31", order: 0 },
  { key: "2026-11", label: "November 2026", from: "2026-11-01", to: "2026-11-30", order: 1 },
];
const rec = (day: string, group: string | null, candidates: string[], qty: number, prodshade: string, loc: string): StorePlanRecord => ({ day, candidates, group_id: group, storage_location_id: loc, qty, prodshade_material_id: prodshade, sku_material_id: null, kind: "RM" });
const productGroupOf = (r: StorePlanRecord) => (r.prodshade_material_id === "P1" ? { mother: "PUTTY", child: "EXT PUTTY" } : r.prodshade_material_id === "P2" ? { mother: "PUTTY", child: "INT PUTTY" } : { mother: "PAINT", child: "PRIMER" });

function input(): StorePlanInput {
  return {
    periods,
    draws: [
      { day: "2026-10-29", material_id: "GAB", destination_kind: "GROUP", group_id: "G", qty_base: 60, source_kind: "OPENING", source_reference: "Opening stock 1" },
      { day: "2026-10-29", material_id: "TS", destination_kind: "GROUP", group_id: "G", qty_base: 40, source_kind: "OPENING", source_reference: "Opening stock 1" },
      { day: "2026-11-02", material_id: "TS", destination_kind: "GROUP", group_id: "G", qty_base: 60, source_kind: "CONFIRMED_ETA", source_reference: "CSN 3000000229" },
      { day: "2026-11-02", material_id: "TS", destination_kind: "GROUP", group_id: "G", qty_base: 30, source_kind: "CONFIRMED_ETA", source_reference: "CSN 3000000999" },
      { day: "2026-11-02", material_id: "TS", destination_kind: "GROUP", group_id: "G", qty_base: 10, source_kind: "ENGINE_LOT", source_reference: "Engine lot TS #1" },
      { day: "2026-10-29", material_id: "GAB", destination_kind: "OWN", group_id: null, qty_base: 40, source_kind: "OPENING", source_reference: "Opening stock 1" },
      { day: "2026-11-02", material_id: "GAB", destination_kind: "OWN", group_id: null, qty_base: 50, source_kind: "OPENING", source_reference: "Opening stock 1" },
      { day: "2026-11-02", material_id: "STRAIGHT", destination_kind: "OWN", group_id: null, qty_base: 9, source_kind: "OPENING", source_reference: "Opening stock 1" },
    ],
    assumedSources: new Set(["CSN 3000000999"]),
    openingByMaterial: { GAB: 900, TS: 800 },
    groupUnmet: [{ group_id: "G", day: "2026-11-30", qty_base: 25 }],
    records: [
      rec("2026-10-29", "G", ["GAB", "TS"], 60, "P1", "L1"), rec("2026-10-29", "G", ["GAB", "TS"], 20, "P2", "L1"), rec("2026-10-29", "G", ["GAB", "TS"], 20, "P3", "L2"),
      rec("2026-11-02", "G", ["GAB", "TS"], 100, "P1", "L1"),
      rec("2026-10-29", null, ["GAB"], 40, "P1", "L1"), rec("2026-11-02", null, ["GAB"], 50, "P1", "L1"),
    ],
    matrix: [
      { day: "2026-10-31", levels: [{ level_kind: "OWN", level_id: "GAB", by_material: { GAB: 500 } }, { level_kind: "GROUP", level_id: "G", by_material: { GAB: 300, TS: 700 } }], pool: { GAB: 20, TS: 80 }, closing: { GAB: 820, TS: 780 } },
      { day: "2026-11-30", levels: [{ level_kind: "OWN", level_id: "GAB", by_material: { GAB: 450 } }, { level_kind: "GROUP", level_id: "G", by_material: { GAB: 300, TS: 600 } }], pool: { GAB: 5, TS: 0 }, closing: { GAB: 755, TS: 600 } },
    ],
    maxDays: new Map([["GROUP|G", 60], ["OWN|GAB", 60]]),
    groupMemberIds: new Set(["GAB", "TS"]),
    productGroupOf,
  };
}

Deno.test("group items per period: use, the reserve to keep at the period end up to Max days, and one row per parent group", () => {
  const plan = buildStorePlan(input());
  const oct = plan.rows.filter((r) => r.period === "2026-10" && r.level_kind === "GROUP" && r.material_id === "TS");
  assert(oct.length === 2, "two parent groups used TS in October (PUTTY, PAINT)");
  const putty = oct.find((r) => r.mother_group === "PUTTY");
  assert(putty && Math.abs(putty.use_qty - 32) < 1e-6 && putty.child_group === "EXT PUTTY; INT PUTTY", `PUTTY child groups share ONE row: ${JSON.stringify(putty)}`);
  assert(putty.keep_max_days === 60, "Max days of the level");
  assert(Math.abs(oct.reduce((s, r) => s + (r.keep_qty ?? 0), 0) - 700) < 1e-6, "keep 700 split over the parent groups, never repeated");
  assert(Math.abs(oct.reduce((s, r) => s + r.use_stock, 0) - 40) < 1e-6, "use adds up to what the group drew");
});

Deno.test("a group member's exclusive use is included; a straight item is not", () => {
  const plan = buildStorePlan(input());
  const own = plan.rows.filter((r) => r.level_kind === "OWN" && r.material_id === "GAB");
  assert(own.length >= 2, "exclusive use of the group member GAB");
  const oct = own.filter((r) => r.period === "2026-10");
  assert(Math.abs(oct.reduce((s, r) => s + r.use_qty, 0) - 40) < 1e-6, "100 demand - 60 drawn by the group = 40 exclusive");
  assert(Math.abs(oct.reduce((s, r) => s + (r.keep_qty ?? 0), 0) - 500) < 1e-6, "the Exclusive reserve at 31 Oct");
  assert(!plan.rows.some((r) => r.material_id === "STRAIGHT"), "a straight item is not a group item");
});

Deno.test("shortage and excess: the group's unmet quantity is its own row, the pool left at each period end is reported per item", () => {
  const plan = buildStorePlan(input());
  const short = plan.rows.find((r) => r.material_id === null && r.period === "2026-11");
  assert(short && Math.abs(plan.rows.filter((r) => r.material_id === null).reduce((s, r) => s + r.not_backed_qty, 0) - 25) < 1e-6, "25 KG not backed");
  const ex = (p: string, m: string) => plan.excess.find((e) => e.period === p && e.material_id === m)?.excess_qty;
  assert(ex("2026-10", "TS") === 80 && ex("2026-11", "TS") === 0 && ex("2026-11", "GAB") === 5, JSON.stringify(plan.excess));
});

Deno.test("where the demand sits: the quantity each member must reach a store, by location", () => {
  const plan = buildStorePlan(input());
  const ts = plan.needs.filter((n) => n.material_id === "TS" && n.period === "2026-10");
  assert(ts.length === 2 && Math.abs(ts.find((n) => n.location_id === "L1")!.qty - 32) < 1e-6 && Math.abs(ts.find((n) => n.location_id === "L2")!.qty - 8) < 1e-6, JSON.stringify(ts));
});

Deno.test("owner 2026-10-28: Store may issue only ACTUAL stock — an unreceived CSN, a piece with its ETA passed or missing, and an unordered lot are separate columns", () => {
  const plan = buildStorePlan(input());
  const nov = plan.rows.filter((r) => r.period === "2026-11" && r.level_kind === "GROUP" && r.material_id === "TS");
  const sum = (key: "use_stock" | "use_arrival" | "use_assumed" | "use_lot" | "use_qty") => nov.reduce((s, r) => s + r[key], 0);
  assert(Math.abs(sum("use_stock")) < 1e-6, "nothing of TS in November is backed by actual stock");
  assert(Math.abs(sum("use_arrival") - 60) < 1e-6, "60 KG depends on CSN 3000000229, valid ETA, not received");
  assert(Math.abs(sum("use_assumed") - 30) < 1e-6, "30 KG depends on a piece whose ETA passed: assumed arrived, never received");
  assert(Math.abs(sum("use_lot") - 10) < 1e-6 && Math.abs(sum("use_qty") - 100) < 1e-6, "10 KG is a lot nobody ordered; the parts add up to the planned use");
  // transfers are advised only for actual stock
  assert(!plan.needs.some((n) => n.period === "2026-11" && n.material_id === "TS"), "no transfer need for stock that has not been received");
  assert(plan.needs.some((n) => n.period === "2026-10" && n.material_id === "TS"), "October TS is actual stock");
  assert(plan.excess.find((e) => e.period === "2026-10" && e.material_id === "TS")?.stock_now === 800, "stock now is shown beside the excess");
});
