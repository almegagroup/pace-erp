/* PO22 Phase 3B: pure source adapters and immutable snapshot persistence shape. */

import { canonicalJson, isIsoDate, partitionPoLineInbound, type InboundEvent } from "./mts_requirement.logic.ts";
import { normalizeOptimizerSources } from "./mts_optimizer_input.logic.ts";
import type { OptimizerInboundSource, OptimizerRawSources } from "./mts_optimizer_input.types.ts";
import {
  OPTIMIZER_SOURCE_CONTRACT_VERSION,
  OPTIMIZER_SOURCE_TABLES,
  type OptimizerMonthlyMaterialSelection,
  type OptimizerNewBuyEligibility,
  type OptimizerPersistentInputSnapshot,
  type OptimizerPhase3BAdapterInput,
  type OptimizerRunProvenance,
} from "./mts_optimizer_phase3b.types.ts";

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function assertCompany(expected: string, source: string, key: string, actual: string): void {
  if (actual !== expected) throw new Error(`${source} ${key} belongs to ${actual}, not requested company ${expected}.`);
}

function sourceKey(poLineId: string, event: InboundEvent, ordinal: number): string {
  // A PO header/CSN number is not a lifecycle identity.  PO-line + one ordered
  // partition is deterministic and lets Phase 3A fail closed on duplicate data.
  return `po-line:${poLineId}:partition:${ordinal}:${event.kind}`;
}

/**
 * Converts read-only, company-scoped evidence into the existing Phase 3A raw
 * input contract.  It does not query a database, mutate documents, choose a
 * group member, net reservations, or compute an allocation.
 */
export function adaptOptimizerPhase3BSources(input: OptimizerPhase3BAdapterInput): OptimizerRawSources {
  const companyId = input.company_id;
  const check = (source: string, key: string, rowCompany: string) => assertCompany(companyId, source, key, rowCompany);
  input.demand.forEach((row) => check("DEMAND", row.source_identity, row.company_id));
  input.stock.forEach((row) => check("STOCK", row.source_identity, row.company_id));
  input.reservations.forEach((row) => check("RESERVATION", row.source_identity, row.company_id));
  input.po_lines.forEach((row) => check("PO_LINE", row.source_identity, row.company_id));
  input.sto_inbound.forEach((row) => check("STO_CSN", row.source_identity, row.company_id));

  const inbound: OptimizerInboundSource[] = [];
  for (const evidence of [...input.po_lines].sort((a, b) => a.po_line_id.localeCompare(b.po_line_id))) {
    const warnings: Array<{ code: string; message: string; material_id?: string }> = [];
    const events = partitionPoLineInbound(evidence.line, input.as_of, warnings);
    if (warnings.length > 0) {
      // Do not silently drop an unreadable supply source.  A zero quantity in
      // the deliberately unverified unit lets Phase 3A retain a visible
      // MISSING_UOM_CONVERSION state and withhold projected-supply credit.
      // It is evidence of a blocked PO line, never a zero-balance assertion.
      warnings.forEach((warning, ordinal) => inbound.push({
        source_key: `po-line:${evidence.po_line_id}:source-warning:${ordinal}`,
        company_id: companyId,
        material_id: warning.material_id ?? evidence.line.material_id,
        qty: 0,
        uom_code: "UNVERIFIED",
        eta_to_plant: null,
        lifecycle_kind: "PO_REMAINDER",
        reference: `${evidence.line.po_number}/${evidence.line.line_number} · ${warning.code}`,
      }));
      continue;
    }
    events.forEach((event, ordinal) => inbound.push({
      source_key: sourceKey(evidence.po_line_id, event, ordinal),
      company_id: companyId,
      material_id: event.material_id,
      qty: event.qty,
      uom_code: "BASE", // normalized below against the material's actual base UOM
      eta_to_plant: event.date,
      lifecycle_kind: event.kind === "AT_GATE" ? "AT_GATE" : event.kind === "SCHEDULED_LOT" ? "SCHEDULED_LOT" : event.kind === "PO_REMAINDER" ? "PO_REMAINDER" : "IN_TRANSIT",
      reference: event.reference,
    }));
  }

  // partitionPoLineInbound returns material base quantities. Replace the
  // sentinel UOM with each material's verified base code before Phase 3A UOM
  // validation. A material master absence remains an explicit missing state.
  const baseUomByMaterial = new Map(input.materials.map((material) => [material.material_id, material.base_uom_code]));
  const inboundWithUom = inbound.map((row) => ({ ...row, uom_code: row.uom_code === "BASE" ? baseUomByMaterial.get(row.material_id) ?? "BASE" : row.uom_code }));
  return {
    company_id: companyId,
    as_of: input.as_of,
    captured_at: input.captured_at,
    materials: [...input.materials],
    stock_eligibility: {
      policy_source: input.stock_eligibility.policy_source,
      eligible_stock_type_codes: [...input.stock_eligibility.eligible_stock_type_codes],
      excluded_storage_location_ids: [...input.stock_eligibility.excluded_storage_location_ids],
    },
    demand: input.demand.map(({ source_table: _table, source_identity: _identity, ...row }) => row),
    stock: input.stock.map(({ source_table: _table, source_identity: _identity, ...row }) => row),
    reservations: input.reservations.map(({ source_table: _table, source_identity: _identity, ...row }) => row),
    inbound: [...inboundWithUom, ...input.sto_inbound.map(({ source_table: _table, source_identity: _identity, ...row }) => row)],
  };
}

function isMonthFirst(value: string): boolean {
  return isIsoDate(value) && value.slice(8) === "01";
}

/**
 * Resolves current, effective monthly decisions.  It intentionally accepts a
 * deselected material: that blocks only a future tentative new purchase.  It
 * neither removes its posted stock nor its confirmed inbound evidence.
 */
export function resolveNewBuyEligibility(companyId: string, selectionMonth: string, rows: readonly OptimizerMonthlyMaterialSelection[]): OptimizerNewBuyEligibility {
  if (!isMonthFirst(selectionMonth)) throw new Error("Selection month must be an ISO first day of month.");
  const latest = new Map<string, OptimizerMonthlyMaterialSelection>();
  const seenVersions = new Map<string, OptimizerMonthlyMaterialSelection>();
  for (const row of rows) {
    assertCompany(companyId, "MATERIAL_SELECTION", row.source_key, row.company_id);
    if (!isMonthFirst(row.selection_month)) throw new Error(`Invalid selection month for ${row.source_key}.`);
    const versionKey = `${row.material_id}|${row.selection_month}|${row.version_no}`;
    const prior = seenVersions.get(versionKey);
    if (prior && canonicalJson(prior) !== canonicalJson(row)) throw new Error(`Conflicting duplicate material-selection evidence for ${versionKey}.`);
    seenVersions.set(versionKey, row);
    if (row.selection_month > selectionMonth) continue;
    const current = latest.get(row.material_id);
    if (!current || row.selection_month > current.selection_month || (row.selection_month === current.selection_month && row.version_no > current.version_no)) latest.set(row.material_id, row);
  }
  return deepFreeze({ company_id: companyId, selection_month: selectionMonth, selected_material_ids: new Set([...latest.values()].filter((row) => row.is_selected_for_new_purchase).map((row) => row.material_id)) });
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Creates an in-memory immutable representation ready for later persistence.
 * SHA-256 covers business evidence only; captured_at/provenance remain audit
 * metadata so an equivalent re-capture has the same evidence fingerprint.
 */
export async function createPersistentOptimizerInputSnapshot(raw: OptimizerRawSources, provenance: Omit<OptimizerRunProvenance, "source_contract_version" | "source_tables"> & { source_tables?: readonly string[] }): Promise<OptimizerPersistentInputSnapshot> {
  const normalized = normalizeOptimizerSources(raw);
  if (!provenance.captured_at) throw new Error("Snapshot provenance requires captured_at.");
  const businessEvidence = {
    company_id: normalized.company_id,
    as_of: normalized.as_of,
    source_fingerprint: normalized.source_fingerprint,
    demand: normalized.demand,
    stock: normalized.stock,
    reservations: normalized.reservations,
    inbound: normalized.inbound,
    missing_data: normalized.missing_data,
    planning_blockers: normalized.planning_blockers,
  };
  const completeProvenance: OptimizerRunProvenance = {
    source_contract_version: OPTIMIZER_SOURCE_CONTRACT_VERSION,
    captured_at: provenance.captured_at,
    captured_by: provenance.captured_by,
    adapter_versions: { ...provenance.adapter_versions },
    source_tables: [...(provenance.source_tables ?? Object.values(OPTIMIZER_SOURCE_TABLES).flat())].sort(),
  };
  return deepFreeze({ schema_version: 1, normalized, sha256_business_fingerprint: await sha256(businessEvidence), provenance: completeProvenance });
}
