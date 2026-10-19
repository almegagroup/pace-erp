import { normalizeOptimizerSources } from "./mts_optimizer_input.logic.ts";
import { allocateCurrentPhysicalStock } from "./mts_optimizer_phase3c.logic.ts";
import type { OptimizerRawSources } from "./mts_optimizer_input.types.ts";

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
const material = (id: string) => ({ material_id: id, base_uom_code: "KG", to_base_factors: { KG: 1 } });
function source(overrides: Partial<OptimizerRawSources> = {}): OptimizerRawSources {
  return {
    company_id: "CMP003", as_of: "2026-10-19", captured_at: "2026-10-19T00:00:00Z",
    materials: [material("M1"), material("M2")],
    stock_eligibility: { policy_source: "test", eligible_stock_type_codes: ["UNRESTRICTED"], excluded_storage_location_ids: ["OT01", "OT02"] },
    demand: [], stock: [], reservations: [], inbound: [], ...overrides,
  };
}
function allocate(raw: OptimizerRawSources, members: Array<{ demand_source_key: string; group_id: string; material_id: string; active: boolean; source_key: string }> = []) {
  return allocateCurrentPhysicalStock({ snapshot: normalizeOptimizerSources(raw), group_members: members });
}

Deno.test("CMP003 jointly protects fixed demand and pools only eligible R/S stock once", () => {
  const result = allocate(source({
    stock: [
      { source_key: "r-m1", company_id: "CMP003", material_id: "M1", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 10, uom_code: "KG", posted_at: "2026-10-18" },
      { source_key: "s-m2", company_id: "CMP003", material_id: "M2", storage_location_id: "S001", stock_type_code: "UNRESTRICTED", qty: 4, uom_code: "KG", posted_at: "2026-10-18" },
      { source_key: "ot-m1", company_id: "CMP003", material_id: "M1", storage_location_id: "OT01", stock_type_code: "UNRESTRICTED", qty: 50, uom_code: "KG", posted_at: "2026-10-18" },
    ],
    reservations: [{ source_key: "res-m1", company_id: "CMP003", material_id: "M1", storage_location_id: "R001", qty: 1, uom_code: "KG", status: "OPEN" }],
    demand: [
      { source_key: "fixed", company_id: "CMP003", product_id: "P1", source_line_id: "L1", required_by: "2026-10-19", demand_kind: "FIXED_EXCLUSIVE", group_id: null, material_id: "M1", uom_evidence: null, qty: 7, uom_code: "KG" },
      { source_key: "pool", company_id: "CMP003", product_id: "P2", source_line_id: "L2", required_by: "2026-10-19", demand_kind: "GROUP_POOL", group_id: "G1", material_id: null, uom_evidence: { base_uom_code: "KG", to_base_factors: { KG: 1 }, source: "test" }, qty: 6, uom_code: "KG" },
    ],
  }), [
    { demand_source_key: "pool", group_id: "G1", material_id: "M1", active: true, source_key: "g1-m1" },
    { demand_source_key: "pool", group_id: "G1", material_id: "M2", active: true, source_key: "g1-m2" },
  ]);
  const fixed = result.rows.find((row) => row.demand_source_key === "fixed")!;
  const pool = result.rows.filter((row) => row.demand_source_key === "pool");
  equal(fixed.executable_qty_base, 7, "exclusive first at same required date");
  equal(pool.map((row) => [row.material_id, row.executable_qty_base, row.uncovered_qty_base]), [["M1", 2, 0], ["M2", 4, 0]], "pool shares only net eligible stock");
  equal(result.material_balances.map((row) => [row.material_id, row.executable_opening_qty_base, row.executable_allocated_qty_base]), [["M1", 9, 9], ["M2", 4, 4]], "OT01 excluded and reservation netted once");
});

Deno.test("uncovered GROUP_POOL remains material-null rather than assigning a default member", () => {
  const result = allocate(source({
    stock: [{ source_key: "m1", company_id: "CMP003", material_id: "M1", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 2, uom_code: "KG", posted_at: "2026-10-18" }],
    demand: [{ source_key: "pool", company_id: "CMP003", product_id: "P1", source_line_id: "L1", required_by: null, demand_kind: "GROUP_POOL", group_id: "G1", material_id: null, uom_evidence: { base_uom_code: "KG", to_base_factors: { KG: 1 }, source: "test" }, qty: 5, uom_code: "KG" }],
  }), [{ demand_source_key: "pool", group_id: "G1", material_id: "M1", active: true, source_key: "g1-m1" }]);
  equal(result.rows.map((row) => [row.material_id, row.executable_qty_base, row.uncovered_qty_base]), [["M1", 2, 0], [null, 0, 3]], "residual stays group-owned");
});

Deno.test("group membership is scoped to its formulation source line, not pooled by group ID", () => {
  const result = allocate(source({
    stock: [{ source_key: "m1", company_id: "CMP003", material_id: "M1", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 5, uom_code: "KG", posted_at: "2026-10-18" }],
    demand: [{ source_key: "pool-a", company_id: "CMP003", product_id: "P1", source_line_id: "L1", required_by: null, demand_kind: "GROUP_POOL", group_id: "G1", material_id: null, uom_evidence: { base_uom_code: "KG", to_base_factors: { KG: 1 }, source: "test" }, qty: 5, uom_code: "KG" }],
  }), [{ demand_source_key: "other-pool", group_id: "G1", material_id: "M1", active: true, source_key: "other-line-member" }]);
  equal(result.rows.map((row) => [row.material_id, row.executable_qty_base, row.uncovered_qty_base]), [[null, 0, 5]], "a group ID alone cannot widen a source line's eligible members");
  assert(result.exceptions.some((item) => item.code === "NO_ACTIVE_GROUP_MEMBER"), "missing source-scoped membership is explicit");
});

Deno.test("group member evidence with a mismatched group ID blocks the demand source", () => {
  const result = allocate(source({
    stock: [{ source_key: "m1", company_id: "CMP003", material_id: "M1", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 5, uom_code: "KG", posted_at: "2026-10-18" }],
    demand: [{ source_key: "pool", company_id: "CMP003", product_id: "P1", source_line_id: "L1", required_by: null, demand_kind: "GROUP_POOL", group_id: "G1", material_id: null, uom_evidence: { base_uom_code: "KG", to_base_factors: { KG: 1 }, source: "test" }, qty: 5, uom_code: "KG" }],
  }), [{ demand_source_key: "pool", group_id: "WRONG-GROUP", material_id: "M1", active: true, source_key: "wrong-member" }]);
  equal(result.rows.map((row) => [row.allocation_state, row.material_id, row.executable_qty_base, row.uncovered_qty_base]), [["BLOCKED", null, 0, 5]], "wrong group evidence cannot allocate stock");
  assert(result.exceptions.some((item) => item.code === "GROUP_MEMBER_GROUP_MISMATCH"), "mismatch remains visible");
});

Deno.test("future inbound is projection evidence and cannot become executable Store quantity", () => {
  const result = allocate(source({
    stock: [{ source_key: "m1", company_id: "CMP003", material_id: "M1", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 2, uom_code: "KG", posted_at: "2026-10-18" }],
    inbound: [{ source_key: "csn-1", company_id: "CMP003", material_id: "M1", qty: 10, uom_code: "KG", eta_to_plant: "2026-10-21", lifecycle_kind: "IN_TRANSIT", reference: "test" }],
    demand: [{ source_key: "fixed", company_id: "CMP003", product_id: "P1", source_line_id: "L1", required_by: "2026-10-19", demand_kind: "FIXED_EXCLUSIVE", group_id: null, material_id: "M1", uom_evidence: null, qty: 5, uom_code: "KG" }],
  }));
  const row = result.rows[0];
  equal([row.executable_qty_base, row.uncovered_qty_base], [2, 3], "only posted stock is executable");
  equal(result.projected_inbound.map((entry) => [entry.qty_base, entry.executable]), [[10, false]], "inbound remains non-executable projection");
});

Deno.test("dated fixed demand protects shared material before later group forecast", () => {
  const result = allocate(source({
    stock: [{ source_key: "m1", company_id: "CMP003", material_id: "M1", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 5, uom_code: "KG", posted_at: "2026-10-18" }],
    demand: [
      { source_key: "later-pool", company_id: "CMP003", product_id: "P2", source_line_id: "L2", required_by: "2026-10-20", demand_kind: "GROUP_POOL", group_id: "G1", material_id: null, uom_evidence: { base_uom_code: "KG", to_base_factors: { KG: 1 }, source: "test" }, qty: 3, uom_code: "KG" },
      { source_key: "earlier-fixed", company_id: "CMP003", product_id: "P1", source_line_id: "L1", required_by: "2026-10-19", demand_kind: "FIXED_EXCLUSIVE", group_id: null, material_id: "M1", uom_evidence: null, qty: 4, uom_code: "KG" },
    ],
  }), [{ demand_source_key: "later-pool", group_id: "G1", material_id: "M1", active: true, source_key: "g1-m1" }]);
  equal(result.rows.map((row) => [row.demand_source_key, row.material_id, row.executable_qty_base, row.uncovered_qty_base]), [["earlier-fixed", "M1", 4, 0], ["later-pool", "M1", 1, 0], ["later-pool", null, 0, 2]], "date-wise conservation protects fixed demand");
});

Deno.test("a material shared by multiple group pools and exclusive demand is consumed only once", () => {
  const result = allocate(source({
    stock: [{ source_key: "m1", company_id: "CMP003", material_id: "M1", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 10, uom_code: "KG", posted_at: "2026-10-18" }],
    demand: [
      { source_key: "fixed", company_id: "CMP003", product_id: "P1", source_line_id: "L1", required_by: "2026-10-19", demand_kind: "FIXED_EXCLUSIVE", group_id: null, material_id: "M1", uom_evidence: null, qty: 4, uom_code: "KG" },
      { source_key: "group-a", company_id: "CMP003", product_id: "P2", source_line_id: "L2", required_by: "2026-10-20", demand_kind: "GROUP_POOL", group_id: "G1", material_id: null, uom_evidence: { base_uom_code: "KG", to_base_factors: { KG: 1 }, source: "test" }, qty: 4, uom_code: "KG" },
      { source_key: "group-b", company_id: "CMP003", product_id: "P3", source_line_id: "L3", required_by: "2026-10-21", demand_kind: "GROUP_POOL", group_id: "G2", material_id: null, uom_evidence: { base_uom_code: "KG", to_base_factors: { KG: 1 }, source: "test" }, qty: 4, uom_code: "KG" },
    ],
  }), [
    { demand_source_key: "group-a", group_id: "G1", material_id: "M1", active: true, source_key: "g1-m1" },
    { demand_source_key: "group-b", group_id: "G2", material_id: "M1", active: true, source_key: "g2-m1" },
  ]);
  equal(result.rows.map((row) => [row.demand_source_key, row.material_id, row.executable_qty_base, row.uncovered_qty_base]), [
    ["fixed", "M1", 4, 0], ["group-a", "M1", 4, 0], ["group-b", "M1", 2, 0], ["group-b", null, 0, 2],
  ], "one shared physical balance cannot satisfy exclusive and both group pools twice");
  equal(result.material_balances[0].executable_closing_qty_base, 0, "the shared physical balance is exhausted exactly once");
});

Deno.test("invalid reservation UOM blocks material instead of increasing executable stock", () => {
  const result = allocate(source({
    stock: [{ source_key: "m1", company_id: "CMP003", material_id: "M1", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 5, uom_code: "KG", posted_at: "2026-10-18" }],
    reservations: [{ source_key: "unknown-uom", company_id: "CMP003", material_id: "M1", storage_location_id: "R001", qty: 1, uom_code: "L", status: "OPEN" }],
    demand: [{ source_key: "fixed", company_id: "CMP003", product_id: "P1", source_line_id: "L1", required_by: null, demand_kind: "FIXED_EXCLUSIVE", group_id: null, material_id: "M1", uom_evidence: null, qty: 1, uom_code: "KG" }],
  }));
  equal([result.rows[0].allocation_state, result.rows[0].executable_qty_base], ["BLOCKED", 0], "unknown reservation cannot be treated as zero");
  assert(result.exceptions.some((item) => item.code === "MATERIAL_EXECUTABLE_STOCK_BLOCKED"), "blocked evidence retained");
});

Deno.test("CMP005 permits a valid non-R/S location when policy permits it", () => {
  const raw = source({ company_id: "CMP005", stock_eligibility: { policy_source: "cmp005", eligible_stock_type_codes: ["UNRESTRICTED"], excluded_storage_location_ids: [] },
    stock: [{ source_key: "valid", company_id: "CMP005", material_id: "M1", storage_location_id: "WH-A", stock_type_code: "UNRESTRICTED", qty: 3, uom_code: "KG", posted_at: "2026-10-18" }],
    demand: [{ source_key: "fixed", company_id: "CMP005", product_id: "P1", source_line_id: "L1", required_by: null, demand_kind: "FIXED_EXCLUSIVE", group_id: null, material_id: "M1", uom_evidence: null, qty: 3, uom_code: "KG" }],
  });
  equal(allocate(raw).rows[0].executable_qty_base, 3, "location names are not inferred from R/S prefixes");
});
