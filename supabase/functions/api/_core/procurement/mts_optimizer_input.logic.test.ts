import { normalizeOptimizerSources } from "./mts_optimizer_input.logic.ts";
import { OptimizerSourceScopeError, type OptimizerRawSources } from "./mts_optimizer_input.types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function fixture(): OptimizerRawSources {
  return {
    company_id: "CMP003", as_of: "2026-10-17", captured_at: "2026-10-17T05:30:00.000Z",
    materials: [{ material_id: "MAT-1", base_uom_code: "KG", to_base_factors: { MT: 1000, KG: 1 } }],
    demand: [{ source_key: "demand-1", company_id: "CMP003", product_id: "SKU-1", source_line_id: "stroke-1", required_by: "2026-10-20", demand_kind: "FIXED_EXCLUSIVE", group_id: null, material_id: "MAT-1", qty: 2, uom_code: "MT" }],
    stock: [{ source_key: "ledger-1", company_id: "CMP003", material_id: "MAT-1", storage_location_id: "R001", stock_type_code: "UNRESTRICTED", qty: 1.5, uom_code: "MT", posted_at: "2026-10-16T23:59:59Z" }],
    reservations: [{ source_key: "reservation-1", company_id: "CMP003", material_id: "MAT-1", storage_location_id: "R001", qty: 200, uom_code: "KG", status: "OPEN" }],
    inbound: [{ source_key: "csn-line-1", company_id: "CMP003", material_id: "MAT-1", qty: 3, uom_code: "MT", eta_to_plant: "2026-10-25", lifecycle_kind: "IN_TRANSIT", reference: "CSN-1/1" }],
  };
}

Deno.test("Phase 3A normalizes all quantity evidence to material base UOM", () => {
  const result = normalizeOptimizerSources(fixture());
  equal(result.demand[0].qty_base, 2000, "demand MT→KG");
  equal(result.stock[0].qty_base, 1500, "stock MT→KG");
  equal(result.reservations[0].qty_base, 200, "reservation KG remains KG");
  equal(result.inbound[0].qty_base, 3000, "inbound MT→KG");
  equal(result.missing_data, [], "complete evidence has no missing-data state");
});

Deno.test("Phase 3A rejects cross-company evidence instead of silently pooling it", () => {
  const raw = fixture();
  raw.stock[0].company_id = "CMP005";
  let error: unknown;
  try { normalizeOptimizerSources(raw); } catch (caught) { error = caught; }
  assert(error instanceof OptimizerSourceScopeError, "cross-company row must throw source-scope error");
  equal(error.source, "STOCK", "error identifies source domain");
});

Deno.test("Phase 3A exposes missing UOM conversions without inventing quantities", () => {
  const raw = fixture();
  raw.demand[0].uom_code = "L";
  const result = normalizeOptimizerSources(raw);
  equal(result.demand[0].qty_base, null, "unknown conversion produces no base quantity");
  assert(result.missing_data.some((item) => item.code === "MISSING_UOM_CONVERSION" && item.source_key === "demand-1"), "conversion gap is explicit");
});

Deno.test("Phase 3A deduplicates exact stock/inbound lifecycle evidence and flags conflicting duplicates", () => {
  const raw = fixture();
  raw.stock.push({ ...raw.stock[0] });
  raw.inbound.push({ ...raw.inbound[0] });
  raw.stock.push({ ...raw.stock[0], qty: 9 });
  raw.inbound.push({ ...raw.inbound[0], eta_to_plant: "2026-10-26" });
  const result = normalizeOptimizerSources(raw);
  equal(result.stock.length, 1, "ledger event counted once");
  equal(result.inbound.length, 1, "CSN lifecycle event counted once");
  assert(result.missing_data.some((item) => item.code === "DUPLICATE_STOCK_EVENT"), "conflicting stock duplicate is visible");
  assert(result.missing_data.some((item) => item.code === "DUPLICATE_INBOUND_EVENT"), "conflicting inbound duplicate is visible");
});

Deno.test("Phase 3A fingerprints are stable despite source-array ordering", () => {
  const first = fixture();
  const second = fixture();
  const extraMaterial = { material_id: "MAT-2", base_uom_code: "KG", to_base_factors: { KG: 1 } };
  first.materials.push(extraMaterial);
  second.materials.unshift(extraMaterial);
  second.stock.unshift({ source_key: "ledger-2", company_id: "CMP003", material_id: "MAT-1", storage_location_id: "S001", stock_type_code: "UNRESTRICTED", qty: 100, uom_code: "KG", posted_at: "2026-10-16T23:59:59Z" });
  first.stock.push(second.stock[0]);
  const a = normalizeOptimizerSources(first);
  second.stock.reverse();
  const b = normalizeOptimizerSources(second);
  equal(a.source_fingerprint, b.source_fingerprint, "normalization fingerprint is order-independent");
});

Deno.test("Phase 3A records unknown ETA as an explicit non-creditable state", () => {
  const raw = fixture();
  raw.inbound[0].eta_to_plant = null;
  const result = normalizeOptimizerSources(raw);
  assert(result.missing_data.some((item) => item.code === "UNKNOWN_ETA"), "unknown ETA cannot silently count as on-time supply");
});
