/* Phase 3A source normalization. No database I/O and no allocation/optimization. */
import { canonicalJson, roundQty } from "./mts_requirement.logic.ts";
import {
  type OptimizerDemandInput,
  type OptimizerInboundInput,
  type OptimizerInputSnapshot,
  type OptimizerMaterialUom,
  type OptimizerMissingData,
  type OptimizerRawSources,
  OptimizerSourceScopeError,
  type OptimizerStockInput,
  type OptimizerReservationInput,
} from "./mts_optimizer_input.types.ts";

type QuantitySource = { source_key: string; company_id: string; material_id: string | null; qty: number; uom_code: string };
type NormalizedQty = { qty_base: number | null; base_uom_code: string | null; missing: OptimizerMissingData | null };

function fingerprint(value: unknown): string {
  // Stable non-cryptographic identifier; persistent run storage will add SHA-256 in Phase 3B.
  let hash = 0xcbf29ce484222325n;
  for (const char of canonicalJson(value)) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function assertCompany<T extends { company_id: string; source_key: string }>(expected: string, source: string, row: T): T {
  if (row.company_id !== expected) throw new OptimizerSourceScopeError(source, row.source_key, expected, row.company_id);
  return row;
}

function normalizedQty(row: QuantitySource, source: OptimizerMissingData["source"], materials: Map<string, OptimizerMaterialUom>): NormalizedQty {
  const material = row.material_id ? materials.get(row.material_id) : undefined;
  const qty = Number(row.qty);
  if (!Number.isFinite(qty) || qty < 0) {
    return { qty_base: null, base_uom_code: material?.base_uom_code ?? null, missing: { code: "INVALID_QUANTITY", source, source_key: row.source_key, material_id: row.material_id, message: "Quantity must be a finite non-negative value." } };
  }
  if (!material) {
    return { qty_base: null, base_uom_code: null, missing: { code: "MISSING_UOM_CONVERSION", source, source_key: row.source_key, material_id: row.material_id, message: "Material base UOM/conversion evidence is unavailable." } };
  }
  const uom = String(row.uom_code ?? "").trim().toUpperCase();
  const base = material.base_uom_code.toUpperCase();
  const factor = uom === base ? 1 : Number(material.to_base_factors[uom]);
  if (!uom || !Number.isFinite(factor) || factor <= 0) {
    return { qty_base: null, base_uom_code: material.base_uom_code, missing: { code: "MISSING_UOM_CONVERSION", source, source_key: row.source_key, material_id: row.material_id, message: `No verified ${uom || "blank"} to ${material.base_uom_code} conversion.` } };
  }
  return { qty_base: roundQty(qty * factor), base_uom_code: material.base_uom_code, missing: null };
}

function dedupe<T extends { source_key: string }>(rows: T[], source: OptimizerMissingData["source"], code: "DUPLICATE_STOCK_EVENT" | "DUPLICATE_INBOUND_EVENT", missing: OptimizerMissingData[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const seen = byKey.get(row.source_key);
    if (!seen) { byKey.set(row.source_key, row); continue; }
    if (canonicalJson(seen) !== canonicalJson(row)) {
      missing.push({ code, source, source_key: row.source_key, material_id: "material_id" in row ? String(row.material_id ?? "") || null : null, message: "Duplicate source key has conflicting evidence; no duplicate quantity was accepted." });
    }
  }
  return [...byKey.values()].sort((a, b) => a.source_key.localeCompare(b.source_key));
}

export function normalizeOptimizerSources(raw: OptimizerRawSources): OptimizerInputSnapshot {
  const materials = [...raw.materials].sort((a, b) => a.material_id.localeCompare(b.material_id));
  const materialMap = new Map(materials.map((row) => [row.material_id, row]));
  const missing: OptimizerMissingData[] = [];
  materials.forEach((row) => { if (!row.material_id) throw new Error("Optimizer material source requires material_id."); });
  raw.demand.forEach((row) => assertCompany(raw.company_id, "DEMAND", row));
  raw.stock.forEach((row) => assertCompany(raw.company_id, "STOCK", row));
  raw.reservations.forEach((row) => assertCompany(raw.company_id, "RESERVATION", row));
  raw.inbound.forEach((row) => assertCompany(raw.company_id, "INBOUND", row));

  const demand: OptimizerDemandInput[] = raw.demand.map((row) => {
    const value = normalizedQty(row, "DEMAND", materialMap); if (value.missing) missing.push(value.missing);
    return { ...row, qty_base: value.qty_base, base_uom_code: value.base_uom_code };
  }).sort((a, b) => a.source_key.localeCompare(b.source_key));
  const stock: OptimizerStockInput[] = dedupe(raw.stock, "STOCK", "DUPLICATE_STOCK_EVENT", missing).map((row) => {
    const value = normalizedQty(row, "STOCK", materialMap); if (value.missing) missing.push(value.missing);
    return { ...row, qty_base: value.qty_base, base_uom_code: value.base_uom_code };
  });
  const reservations: OptimizerReservationInput[] = raw.reservations.map((row) => {
    const value = normalizedQty(row, "RESERVATION", materialMap); if (value.missing) missing.push(value.missing);
    return { ...row, qty_base: value.qty_base, base_uom_code: value.base_uom_code };
  }).sort((a, b) => a.source_key.localeCompare(b.source_key));
  const inbound: OptimizerInboundInput[] = dedupe(raw.inbound, "INBOUND", "DUPLICATE_INBOUND_EVENT", missing).map((row) => {
    const value = normalizedQty(row, "INBOUND", materialMap); if (value.missing) missing.push(value.missing);
    if (!row.eta_to_plant) missing.push({ code: "UNKNOWN_ETA", source: "INBOUND", source_key: row.source_key, material_id: row.material_id, message: "ETA is unknown and cannot receive on-time coverage credit." });
    return { ...row, qty_base: value.qty_base, base_uom_code: value.base_uom_code };
  });
  const missingData = missing.sort((a, b) => `${a.source}|${a.source_key}|${a.code}`.localeCompare(`${b.source}|${b.source_key}|${b.code}`));
  const evidence = { company_id: raw.company_id, as_of: raw.as_of, captured_at: raw.captured_at, materials, demand, stock, reservations, inbound, missing_data: missingData };
  return Object.freeze({ schema_version: 1, ...evidence, source_fingerprint: fingerprint(evidence), demand: Object.freeze(demand), stock: Object.freeze(stock), reservations: Object.freeze(reservations), inbound: Object.freeze(inbound), missing_data: Object.freeze(missingData) });
}
