import { adaptRequirementDemandToOptimizer } from "./mts_optimizer_phase3c_demand.logic.ts";
import type { DemandRecord, GroupMember, MaterialInfo } from "./mts_requirement.logic.ts";

function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function material(id: string, base = "KG"): MaterialInfo {
  return { material_id: id, material_type: "RM", base_uom_code: base, status: "ACTIVE", to_base_factors: { [base]: 1 } };
}
function record(overrides: Partial<DemandRecord> = {}): DemandRecord {
  return {
    day: "2026-11-01", kind: "RM", pool_key: "RM|SL-1", candidates: ["M1"], storage_location_id: "R001", qty: 10,
    prodshade_material_id: "PS-1", sku_material_id: null, stroke_master_id: "SM-1", stroke_line_id: "SL-1",
    pack_bom_id: null, pack_bom_line_id: null, outer_qty: null, outer_uom_code: null, fill_qty_per_outer: null,
    group_id: null, use_primary: null, sort_key: "1|SL-1",
    plan_line_contributions: [{ source_id: "PL-1", entry_id: "E-1", version_no: 1, plan_type: "FINAL", urgent_mode: null, role: "BASE", sku_material_id: "SKU-1", adds_qty: true, qty: overrides.qty ?? 10 }],
    ...overrides,
  };
}
function group(...rows: GroupMember[]): ReadonlyMap<string, readonly GroupMember[]> { return new Map([["G1", rows]]); }

Deno.test("Use Primary No creates material-null GROUP_POOL with immutable member IDs", () => {
  const result = adaptRequirementDemandToOptimizer("CMP003", [record({ group_id: "G1", use_primary: false, candidates: ["M1", "M2"] })],
    group({ material_id: "M1", active: true, group_id: "G1", source_id: "GM-1" }, { material_id: "M2", active: true, group_id: "G1", source_id: "GM-2" }),
    new Map([["M1", material("M1")], ["M2", material("M2")]]));
  equal(result.issues, [], "complete evidence has no issue");
  equal(result.demand.map((row) => [row.demand_kind, row.material_id, row.group_id, row.source_line_id, row.uom_code]), [["GROUP_POOL", null, "G1", "SL-1", "KG"]], "pool retains null material and actual source line");
  equal(result.group_members.map((row) => [row.group_id, row.material_id, row.source_key]), [["G1", "M1", "GM-1"], ["G1", "M2", "GM-2"]], "members retain immutable membership identities");
});

Deno.test("RM Use Primary Yes stays fixed to preserve approved Requirement semantics", () => {
  const result = adaptRequirementDemandToOptimizer("CMP003", [record({ group_id: "G1", use_primary: true, candidates: ["M1", "M2"] })], group(), new Map([["M1", material("M1")], ["M2", material("M2")]]));
  equal(result.demand.map((row) => [row.demand_kind, row.material_id, row.group_id]), [["FIXED_EXCLUSIVE", "M1", null]], "primary source is not widened by this adapter");
});

Deno.test("PM group pool requires the real Pack BOM input-line identity", () => {
  const pm = record({ kind: "PM", pool_key: "PM|B-1|M1", stroke_master_id: null, stroke_line_id: null, pack_bom_id: "B-1", pack_bom_line_id: "BL-1", group_id: "G1", use_primary: null, candidates: ["M1", "M2"] });
  const result = adaptRequirementDemandToOptimizer("CMP005", [pm], group({ material_id: "M1", active: true, group_id: "G1", source_id: "GM-1" }), new Map([["M1", material("M1")], ["M2", material("M2")]]));
  equal(result.demand.map((row) => [row.source_line_id, row.demand_kind, row.material_id]), [["BL-1", "GROUP_POOL", null]], "Pack BOM input identity is mandatory and preserved");
});

Deno.test("missing member identity or incompatible base UOM fails closed", () => {
  const result = adaptRequirementDemandToOptimizer("CMP011", [record({ group_id: "G1", use_primary: false })],
    group({ material_id: "M1", active: true, group_id: "G1" }, { material_id: "M2", active: true, group_id: "G1", source_id: "GM-2" }),
    new Map([["M1", material("M1")], ["M2", material("M2", "L")]]));
  equal(result.demand.length, 0, "incomplete group evidence produces no executable optimizer demand");
  equal(result.issues.map((row) => row.code), ["GROUP_MEMBER_ID_MISSING", "GROUP_MEMBER_UOM_MISMATCH"], "both source defects remain visible");
});

Deno.test("wrong actual group identity is rejected rather than matched by a map position", () => {
  const result = adaptRequirementDemandToOptimizer("CMP003", [record({ group_id: "G1", use_primary: false })],
    group({ material_id: "M1", active: true, group_id: "G2", source_id: "GM-1" }), new Map([["M1", material("M1")]]));
  equal(result.demand.length, 0, "mismatched group has no optimizer demand");
  equal(result.issues.map((row) => row.code), ["GROUP_MEMBER_GROUP_MISMATCH"], "actual group is validated");
});

Deno.test("Demand without provable PO21 plan-line lineage fails closed", () => {
  const materials = new Map([["M1", material("M1")]]);
  const none = adaptRequirementDemandToOptimizer("CMP003", [record({ plan_line_contributions: [] })], group(), materials);
  equal(none.demand.length, 0, "no contributor = no demand");
  equal(none.issues.map((row) => row.code), ["PLAN_LINE_ATTRIBUTION_MISSING"], "missing lineage issue");
  const noId = adaptRequirementDemandToOptimizer("CMP003", [record({ plan_line_contributions: [{ source_id: null, entry_id: "E-1", version_no: 1, plan_type: "FINAL", urgent_mode: null, role: "BASE", sku_material_id: "SKU-1", adds_qty: true, qty: 10 }] })], group(), materials);
  equal(noId.issues.map((row) => row.code), ["PLAN_LINE_ATTRIBUTION_MISSING"], "contributor without row id rejected");
  const short = adaptRequirementDemandToOptimizer("CMP003", [record({ plan_line_contributions: [{ source_id: "PL-1", entry_id: "E-1", version_no: 1, plan_type: "FINAL", urgent_mode: null, role: "BASE", sku_material_id: "SKU-1", adds_qty: true, qty: 9 }] })], group(), materials);
  equal(short.issues.map((row) => row.code), ["PLAN_LINE_ATTRIBUTION_MISSING"], "non-conserving lineage rejected");
  const ok = adaptRequirementDemandToOptimizer("CMP003", [record()], group(), materials);
  equal(ok.demand[0].plan_line_contributions?.map((row) => [row.source_id, row.version_no, row.qty]), [["PL-1", 1, 10]], "lineage carried to optimizer demand");
});
