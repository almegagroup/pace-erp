import { normalizeOptimizerSources } from "./mts_optimizer_input.logic.ts";
import { OptimizerMaterialMasterError, OptimizerSourceScopeError, type OptimizerRawSources } from "./mts_optimizer_input.types.ts";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function fixture(): OptimizerRawSources {
  return {
    company_id: "CMP003", as_of: "2026-10-17", captured_at: "2026-10-17T05:30:00.000Z",
    materials: [{ material_id: "MAT-1", base_uom_code: "KG", to_base_factors: { MT: 1000, KG: 1 } }],
    stock_eligibility: { eligible_stock_type_codes: ["UNRESTRICTED"], excluded_storage_location_ids: ["OT01", "OT02"], policy_source: "CMP003_APPROVED_POLICY" },
    demand: [{ source_key: "demand-1", company_id: "CMP003", product_id: "SKU-1", source_line_id: "stroke-1", required_by: "2026-10-20", demand_kind: "FIXED_EXCLUSIVE", group_id: null, material_id: "MAT-1", uom_evidence: null, qty: 2, uom_code: "MT" }],
    stock: [{ source_key: "ledger-1", company_id: "CMP003", material_id: "MAT-1", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 1.5, uom_code: "MT", posted_at: "2026-10-16T23:59:59Z" }],
    reservations: [{ source_key: "reservation-1", company_id: "CMP003", material_id: "MAT-1", storage_location_id: "R001", qty: 200, uom_code: "KG", status: "OPEN" }],
    inbound: [{ source_key: "csn-line-1", company_id: "CMP003", material_id: "MAT-1", qty: 3, uom_code: "MT", eta_to_plant: "2026-10-25", lifecycle_kind: "IN_TRANSIT", reference: "CSN-1/1" }],
  };
}

Deno.test("Phase 3A normalizes material evidence to base UOM", () => {
  const result = normalizeOptimizerSources(fixture());
  equal(result.demand[0].qty_base, 2000, "demand MT→KG");
  equal(result.stock[0].qty_base, 1500, "stock MT→KG");
  equal(result.reservations[0].qty_base, 200, "reservation KG remains KG");
  equal(result.inbound[0].qty_base, 3000, "inbound MT→KG");
});

Deno.test("CMP003 GROUP_POOL converts with explicit UOM evidence and no member material", () => {
  const raw = fixture();
  raw.demand[0] = { ...raw.demand[0], source_key: "group-rdp", demand_kind: "GROUP_POOL", group_id: "RDP", material_id: null, uom_evidence: { base_uom_code: "KG", to_base_factors: { MT: 1000 }, source: "STROKE_LINE_UOM" }, qty: 4, uom_code: "MT" };
  const result = normalizeOptimizerSources(raw);
  equal(result.demand[0].material_id, null, "group stays unassigned");
  equal(result.demand[0].qty_base, 4000, "group demand converts from verified source UOM");
});

Deno.test("Phase 3A rejects cross-company evidence instead of pooling it", () => {
  const raw = fixture(); raw.stock[0].company_id = "CMP005";
  let error: unknown; try { normalizeOptimizerSources(raw); } catch (caught) { error = caught; }
  assert(error instanceof OptimizerSourceScopeError, "cross-company stock must throw");
});

Deno.test("conflicting stock, reservation and inbound duplicates fail closed", () => {
  const raw = fixture();
  raw.stock.push({ ...raw.stock[0], qty: 9 });
  raw.reservations.push({ ...raw.reservations[0], qty: 9 });
  raw.inbound.push({ ...raw.inbound[0], eta_to_plant: "2026-10-26" });
  const result = normalizeOptimizerSources(raw);
  equal(result.stock.length, 0, "conflicted stock omitted");
  equal(result.reservations.length, 0, "conflicted reservation omitted");
  equal(result.inbound.length, 0, "conflicted inbound omitted");
  assert(result.planning_blockers.some((x) => x.material_id === "MAT-1" && x.domain === "EXECUTABLE_STOCK"), "reservation/stock conflict blocks material availability");
  assert(result.planning_blockers.some((x) => x.material_id === "MAT-1" && x.domain === "PROJECTED_INBOUND"), "inbound conflict blocks forecast");
  assert(result.missing_data.some((x) => x.code === "CONFLICTING_STOCK_EVIDENCE"), "stock conflict visible");
  assert(result.missing_data.some((x) => x.code === "CONFLICTING_RESERVATION_EVIDENCE"), "reservation conflict visible");
  assert(result.missing_data.some((x) => x.code === "CONFLICTING_INBOUND_EVIDENCE"), "inbound conflict visible");
});

Deno.test("exact duplicate lifecycle rows count once", () => {
  const raw = fixture(); raw.stock.push({ ...raw.stock[0] }); raw.reservations.push({ ...raw.reservations[0] }); raw.inbound.push({ ...raw.inbound[0] });
  const result = normalizeOptimizerSources(raw);
  equal([result.stock.length, result.reservations.length, result.inbound.length], [1, 1, 1], "exact duplicate events collapse once");
});

Deno.test("CMP003 OT locations and non-unrestricted stock are explicitly ineligible", () => {
  const raw = fixture();
  raw.stock.push({ ...raw.stock[0], source_key: "ot01", storage_location_id: "OT01" });
  raw.stock.push({ ...raw.stock[0], source_key: "qa", storage_location_id: "R001", stock_type_code: "QUALITY_INSPECTION" });
  const result = normalizeOptimizerSources(raw);
  equal(result.stock.map((x) => [x.source_key, x.planning_eligible, x.exclusion_reason]), [["ledger-1", true, null], ["ot01", false, "LOCATION"], ["qa", false, "STOCK_TYPE"]], "policy, not prefix inference, controls eligibility");
});

Deno.test("ETA states distinguish missing, invalid and overdue", () => {
  const raw = fixture();
  raw.inbound[0].eta_to_plant = null;
  raw.inbound.push({ ...raw.inbound[0], source_key: "bad-date", eta_to_plant: "17-10-2026" });
  raw.inbound.push({ ...raw.inbound[0], source_key: "past-date", eta_to_plant: "2026-10-16" });
  const result = normalizeOptimizerSources(raw);
  equal(result.inbound.map((x) => x.eta_state), ["INVALID", "MISSING", "OVERDUE"], "ETA state is explicit");
  assert(result.missing_data.some((x) => x.code === "ETA_MISSING"), "missing ETA labelled");
  assert(result.missing_data.some((x) => x.code === "ETA_INVALID"), "invalid ETA labelled");
  assert(result.missing_data.some((x) => x.code === "ETA_OVERDUE"), "overdue ETA labelled");
});

Deno.test("business fingerprint ignores captured_at but immutable snapshot freezes nested evidence", () => {
  const first = fixture(); const second = fixture(); second.captured_at = "2026-10-18T05:30:00.000Z";
  const a = normalizeOptimizerSources(first); const b = normalizeOptimizerSources(second);
  equal(a.source_fingerprint, b.source_fingerprint, "capture timestamp is metadata, not business evidence");
  assert(Object.isFrozen(a) && Object.isFrozen(a.stock) && Object.isFrozen(a.stock[0]), "snapshot is deeply frozen");
});

Deno.test("malformed and duplicate material masters are rejected", () => {
  const duplicate = fixture(); duplicate.materials.push({ ...duplicate.materials[0] });
  let duplicateError: unknown; try { normalizeOptimizerSources(duplicate); } catch (caught) { duplicateError = caught; }
  assert(duplicateError instanceof OptimizerMaterialMasterError, "duplicate master rejected");
  const malformed = fixture(); malformed.materials[0].to_base_factors.MT = 0;
  let malformedError: unknown; try { normalizeOptimizerSources(malformed); } catch (caught) { malformedError = caught; }
  assert(malformedError instanceof OptimizerMaterialMasterError, "invalid factor rejected");
});

Deno.test("one conflicted reservation blocks otherwise valid physical stock", () => {
  const raw = fixture();
  raw.reservations.push({ ...raw.reservations[0], qty: 700 });
  const result = normalizeOptimizerSources(raw);
  equal(result.stock[0].planning_eligible, false, "available stock blocked");
  equal(result.stock[0].exclusion_reason, "SOURCE_CONFLICT", "reason explicit");
});

Deno.test("one conflicted inbound source blocks forecast credit for the material", () => {
  const raw = fixture();
  raw.inbound.push({ ...raw.inbound[0], qty: 900 });
  raw.inbound.push({ ...raw.inbound[0], source_key: "other-lot" });
  const result = normalizeOptimizerSources(raw);
  equal(result.inbound.length, 1, "unconflicted inbound retained as evidence");
  equal(result.inbound[0].projected_supply_eligible, false, "material forecast credit blocked");
});

Deno.test("missing CMP003 OT exclusions fail closed; other company location policy remains source-driven", () => {
  const raw = fixture();
  raw.stock_eligibility.excluded_storage_location_ids = ["OT01"];
  let error: unknown; try { normalizeOptimizerSources(raw); } catch (caught) { error = caught; }
  assert(error instanceof Error, "incomplete CMP003 excluded locations rejected");
  const other = fixture(); other.company_id = "CMP005";
  other.demand[0].company_id = "CMP005"; other.stock[0].company_id = "CMP005";
  other.reservations[0].company_id = "CMP005"; other.inbound[0].company_id = "CMP005";
  other.stock_eligibility.excluded_storage_location_ids = [];
  equal(normalizeOptimizerSources(other).stock[0].planning_eligible, true, "company policy is supplied externally");
});

Deno.test("stock policy list ordering does not affect business fingerprint", () => {
  const a = fixture(); const b = fixture();
  a.stock_eligibility.eligible_stock_type_codes.push("QA", "BLOCKED");
  b.stock_eligibility.eligible_stock_type_codes.unshift("BLOCKED", "QA");
  b.stock_eligibility.excluded_storage_location_ids.reverse();
  equal(normalizeOptimizerSources(a).source_fingerprint, normalizeOptimizerSources(b).source_fingerprint, "policy ordering irrelevant");
});
