/* Phase 3A source normalization. No database I/O and no allocation/optimization. */
import { canonicalJson, isIsoDate, roundQty } from "./mts_requirement.logic.ts";
import {
  type OptimizerDemandInput,
  type OptimizerDemandUomEvidence,
  type OptimizerInboundInput,
  type OptimizerInputSnapshot,
  OptimizerMaterialMasterError,
  type OptimizerMaterialUom,
  type OptimizerMissingData,
  type OptimizerPlanningBlocker,
  type OptimizerRawSources,
  OptimizerSourceScopeError,
  type OptimizerStockInput,
  type OptimizerReservationInput,
} from "./mts_optimizer_input.types.ts";

type QuantitySource = { source_key: string; company_id: string; material_id: string | null; qty: number; uom_code: string };
type UomEvidence = { base_uom_code: string; to_base_factors: Record<string, number> };
type NormalizedQty = { qty_base: number | null; base_uom_code: string | null; missing: OptimizerMissingData | null };

function fingerprint(value: unknown): string {
  // Phase 3A's reproducibility identifier. Persistent snapshots require SHA-256 in Phase 3B.
  let hash = 0xcbf29ce484222325n;
  for (const char of canonicalJson(value)) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function assertCompany<T extends { company_id: string; source_key: string }>(expected: string, source: string, row: T): T {
  if (row.company_id !== expected) throw new OptimizerSourceScopeError(source, row.source_key, expected, row.company_id);
  return row;
}

function normalizedQty(row: QuantitySource, source: OptimizerMissingData["source"], materials: Map<string, OptimizerMaterialUom>, explicitUom?: OptimizerDemandUomEvidence | null): NormalizedQty {
  const material = row.material_id ? materials.get(row.material_id) : undefined;
  const evidence: UomEvidence | undefined = material ?? explicitUom ?? undefined;
  const qty = Number(row.qty);
  if (!Number.isFinite(qty) || qty < 0) {
    return { qty_base: null, base_uom_code: evidence?.base_uom_code ?? null, missing: { code: "INVALID_QUANTITY", source, source_key: row.source_key, material_id: row.material_id, message: "Quantity must be a finite non-negative value." } };
  }
  if (!evidence) {
    return { qty_base: null, base_uom_code: null, missing: { code: "MISSING_UOM_CONVERSION", source, source_key: row.source_key, material_id: row.material_id, message: "Verified base-UOM conversion evidence is unavailable." } };
  }
  const uom = String(row.uom_code ?? "").trim().toUpperCase();
  const base = evidence.base_uom_code.toUpperCase();
  const factor = uom === base ? 1 : Number(evidence.to_base_factors[uom]);
  if (!uom || !Number.isFinite(factor) || factor <= 0) {
    return { qty_base: null, base_uom_code: evidence.base_uom_code, missing: { code: "MISSING_UOM_CONVERSION", source, source_key: row.source_key, material_id: row.material_id, message: `No verified ${uom || "blank"} to ${evidence.base_uom_code} conversion.` } };
  }
  return { qty_base: roundQty(qty * factor), base_uom_code: evidence.base_uom_code, missing: null };
}

function dedupeFailClosed<T extends { source_key: string; material_id: string }>(rows: T[], source: OptimizerMissingData["source"], code: "CONFLICTING_STOCK_EVIDENCE" | "CONFLICTING_RESERVATION_EVIDENCE" | "CONFLICTING_INBOUND_EVIDENCE", missing: OptimizerMissingData[]): T[] {
  const byKey = new Map<string, T>();
  const conflicted = new Set<string>();
  for (const row of rows) {
    const seen = byKey.get(row.source_key);
    if (!seen) { byKey.set(row.source_key, row); continue; }
    if (canonicalJson(seen) !== canonicalJson(row)) {
      conflicted.add(row.source_key);
      missing.push({ code, source, source_key: row.source_key, material_id: row.material_id, message: "Conflicting duplicate evidence was excluded in full; no first row was trusted." });
    }
  }
  return [...byKey.values()].filter((row) => !conflicted.has(row.source_key)).sort((a, b) => a.source_key.localeCompare(b.source_key));
}

function validateMaterialMaster(rows: OptimizerMaterialUom[]): OptimizerMaterialUom[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.material_id || !row.base_uom_code) throw new OptimizerMaterialMasterError("Material master requires material_id and base_uom_code.");
    if (ids.has(row.material_id)) throw new OptimizerMaterialMasterError(`Duplicate material master evidence for ${row.material_id}.`);
    ids.add(row.material_id);
    for (const [uom, factor] of Object.entries(row.to_base_factors)) {
      if (!uom || !Number.isFinite(Number(factor)) || Number(factor) <= 0) throw new OptimizerMaterialMasterError(`Invalid conversion for ${row.material_id}/${uom}.`);
    }
  }
  return [...rows].sort((a, b) => a.material_id.localeCompare(b.material_id));
}

export function normalizeOptimizerSources(raw: OptimizerRawSources): OptimizerInputSnapshot {
  if (!isIsoDate(raw.as_of)) throw new Error("Optimizer input as_of must be an ISO date.");
  if (!raw.stock_eligibility.policy_source?.trim() || !raw.stock_eligibility.eligible_stock_type_codes?.length || !Array.isArray(raw.stock_eligibility.excluded_storage_location_ids)) throw new Error("Optimizer stock eligibility requires a sourced stock-type and location-exclusion policy.");
  if (raw.company_id === "CMP003" && !["OT01", "OT02"].every((loc) => raw.stock_eligibility.excluded_storage_location_ids.includes(loc))) throw new Error("CMP003 policy must exclude OT01 and OT02.");
  const materials = validateMaterialMaster(raw.materials);
  const materialMap = new Map(materials.map((row) => [row.material_id, row]));
  const missing: OptimizerMissingData[] = [];
  raw.demand.forEach((row) => assertCompany(raw.company_id, "DEMAND", row));
  raw.stock.forEach((row) => assertCompany(raw.company_id, "STOCK", row));
  raw.reservations.forEach((row) => assertCompany(raw.company_id, "RESERVATION", row));
  raw.inbound.forEach((row) => assertCompany(raw.company_id, "INBOUND", row));

  const demand: OptimizerDemandInput[] = raw.demand.map((row) => {
    const explicit = row.material_id === null && row.demand_kind === "GROUP_POOL" ? row.uom_evidence : null;
    const value = normalizedQty(row, "DEMAND", materialMap, explicit); if (value.missing) missing.push(value.missing);
    return { ...row, qty_base: value.qty_base, base_uom_code: value.base_uom_code };
  }).sort((a, b) => a.source_key.localeCompare(b.source_key));
  // A missing/excess reservation cannot be interpreted as zero: block executable
  // stock use for the affected material. Stock conflicts have the same treatment.
  const blockerCodes = new Set(["CONFLICTING_STOCK_EVIDENCE", "CONFLICTING_RESERVATION_EVIDENCE"]);
  // Deduplicate BEFORE computing blockers so all conflicting keys are known.
  const uniqueStock = dedupeFailClosed(raw.stock, "STOCK", "CONFLICTING_STOCK_EVIDENCE", missing);
  const uniqueReservations = dedupeFailClosed(raw.reservations, "RESERVATION", "CONFLICTING_RESERVATION_EVIDENCE", missing);
  const uniqueInbound = dedupeFailClosed(raw.inbound, "INBOUND", "CONFLICTING_INBOUND_EVIDENCE", missing);
  const blockedStockMaterials = new Set(missing.filter((x) => blockerCodes.has(x.code)).map((x) => x.material_id).filter((x): x is string => !!x));
  const blockedInboundMaterials = new Set(missing.filter((x) => x.code === "CONFLICTING_INBOUND_EVIDENCE").map((x) => x.material_id).filter((x): x is string => !!x));
  const eligibleTypes = new Set(raw.stock_eligibility.eligible_stock_type_codes);
  const excludedLocations = new Set(raw.stock_eligibility.excluded_storage_location_ids);
  const stock: OptimizerStockInput[] = uniqueStock.map((row) => {
    const value = normalizedQty(row, "STOCK", materialMap); if (value.missing) missing.push(value.missing);
    const exclusion_reason = blockedStockMaterials.has(row.material_id) ? "SOURCE_CONFLICT" : excludedLocations.has(row.storage_location_id) ? "LOCATION" : !eligibleTypes.has(row.stock_type_code) ? "STOCK_TYPE" : null;
    return { ...row, qty_base: value.qty_base, base_uom_code: value.base_uom_code, planning_eligible: exclusion_reason === null && value.qty_base !== null, exclusion_reason };
  });
  const reservations: OptimizerReservationInput[] = uniqueReservations.map((row) => {
    const value = normalizedQty(row, "RESERVATION", materialMap); if (value.missing) missing.push(value.missing);
    return { ...row, qty_base: value.qty_base, base_uom_code: value.base_uom_code };
  });
  const inbound: OptimizerInboundInput[] = uniqueInbound.map((row) => {
    const value = normalizedQty(row, "INBOUND", materialMap); if (value.missing) missing.push(value.missing);
    const eta_state = row.eta_to_plant === null ? "MISSING" : !isIsoDate(row.eta_to_plant) ? "INVALID" : row.eta_to_plant < raw.as_of ? "OVERDUE" : "KNOWN";
    if (eta_state !== "KNOWN") missing.push({ code: `ETA_${eta_state}` as OptimizerMissingData["code"], source: "INBOUND", source_key: row.source_key, material_id: row.material_id, message: `Plant ETA is ${eta_state.toLowerCase()} and receives no on-time coverage credit.` });
    return { ...row, qty_base: value.qty_base, base_uom_code: value.base_uom_code, eta_state, projected_supply_eligible: eta_state === "KNOWN" && value.qty_base !== null && !blockedInboundMaterials.has(row.material_id) };
  });
  const planningBlockers: OptimizerPlanningBlocker[] = missing.filter((item) =>
    (item.code === "CONFLICTING_STOCK_EVIDENCE" || item.code === "CONFLICTING_RESERVATION_EVIDENCE" || item.code === "CONFLICTING_INBOUND_EVIDENCE") && !!item.material_id
  ).map((item) => ({ material_id: item.material_id!, domain: item.code === "CONFLICTING_INBOUND_EVIDENCE" ? "PROJECTED_INBOUND" : "EXECUTABLE_STOCK", source_key: item.source_key, reason: item.code }));
  planningBlockers.sort((a, b) => `${a.material_id}|${a.domain}|${a.source_key}|${a.reason}`.localeCompare(`${b.material_id}|${b.domain}|${b.source_key}|${b.reason}`));
  const missingData = missing.sort((a, b) => `${a.source}|${a.source_key}|${a.code}`.localeCompare(`${b.source}|${b.source_key}|${b.code}`));
  // captured_at is audit metadata, intentionally excluded from source_fingerprint.
  const stockEligibility = {
    policy_source: raw.stock_eligibility.policy_source,
    eligible_stock_type_codes: [...eligibleTypes].sort(),
    excluded_storage_location_ids: [...excludedLocations].sort(),
  };
  const businessEvidence = { company_id: raw.company_id, as_of: raw.as_of, materials, stock_eligibility: stockEligibility, demand, stock, reservations, inbound, missing_data: missingData, planning_blockers: planningBlockers };
  return deepFreeze({ schema_version: 1, ...businessEvidence, captured_at: raw.captured_at, source_fingerprint: fingerprint(businessEvidence) });
}
