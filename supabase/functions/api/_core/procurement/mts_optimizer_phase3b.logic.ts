/* PO22 Phase 3B: pure source adapters and immutable snapshot persistence shape. */

import { canonicalJson, isIsoDate, nextMonth, partitionPoLineInbound, type InboundEvent } from "./mts_requirement.logic.ts";
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
  type OptimizerAdaptedPhase3BSources,
  type OptimizerSourceIdentityManifest,
  OptimizerSourceEvidenceConflictError,
  OptimizerSourceIdentityError,
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

function sourceKey(evidence: OptimizerPhase3BAdapterInput["po_lines"][number], event: InboundEvent): string {
  const identities = evidence.lifecycle_identities;
  if (identities.po_line_id !== evidence.po_line_id) throw new OptimizerSourceIdentityError("PO_LINE", evidence.po_line_id);
  if (event.kind === "AT_GATE") {
    const gates = evidence.line.at_gate.filter((item) => event.reference.endsWith(` · ${item.reference}`));
    if (gates.length !== 1) throw new OptimizerSourceIdentityError("GATE_ENTRY_LINE", event.reference);
    const gate = gates[0];
    const id = gate ? identities.gate_entry_line_id_by_reference[gate.reference] : null;
    if (!id) throw new OptimizerSourceIdentityError("GATE_ENTRY_LINE", event.reference);
    return `po-line:${evidence.po_line_id}:gate-entry-line:${id}`;
  }
  if (event.kind === "IN_TRANSIT") {
    const match = / · CSN ([^ ]+) \(/.exec(event.reference);
    if (match && evidence.line.csns.filter((csn) => csn.csn_number === match[1]).length !== 1) throw new OptimizerSourceIdentityError("CSN", event.reference);
    const id = match ? identities.csn_id_by_number[match[1]] : null;
    if (!id) throw new OptimizerSourceIdentityError("CSN", event.reference);
    return `po-line:${evidence.po_line_id}:csn:${id}`;
  }
  if (event.kind === "SCHEDULED_LOT") {
    const match = / · Lot (.+)$/.exec(event.reference);
    if (match && evidence.line.lots.filter((lot) => lot.lot_number === match[1]).length !== 1) throw new OptimizerSourceIdentityError("PO_LOT", event.reference);
    const id = match ? identities.lot_id_by_number[match[1]] : null;
    if (!id) throw new OptimizerSourceIdentityError("PO_LOT", event.reference);
    return `po-line:${evidence.po_line_id}:lot:${id}`;
  }
  // The remaining PO balance has no separate physical event; its identity is
  // the uniquely validated PO line itself, not a partition ordinal.
  return `po-line:${evidence.po_line_id}:remainder`;
}

function poLineBusinessEvidence(row: OptimizerPhase3BAdapterInput["po_lines"][number]): unknown {
  return {
    company_id: row.company_id,
    po_line_id: row.po_line_id,
    line: row.line,
    lifecycle_identities: row.lifecycle_identities,
  };
}

function collapsePoLineEvidence(rows: readonly OptimizerPhase3BAdapterInput["po_lines"][number][]): OptimizerPhase3BAdapterInput["po_lines"][number][] {
  const byLineId = new Map<string, OptimizerPhase3BAdapterInput["po_lines"][number]>();
  for (const row of rows) {
    const prior = byLineId.get(row.po_line_id);
    if (!prior) { byLineId.set(row.po_line_id, row); continue; }
    if (canonicalJson(poLineBusinessEvidence(prior)) !== canonicalJson(poLineBusinessEvidence(row))) {
      throw new OptimizerSourceEvidenceConflictError("PO_LINE", row.po_line_id);
    }
  }
  return [...byLineId.values()].sort((a, b) => a.po_line_id.localeCompare(b.po_line_id));
}

function identityManifest(input: OptimizerPhase3BAdapterInput, poLines: readonly OptimizerPhase3BAdapterInput["po_lines"][number][]): OptimizerSourceIdentityManifest {
  const unique = (values: readonly string[]) => [...new Set(values.filter(Boolean))].sort();
  return deepFreeze({
    demand: unique(input.demand.map((row) => row.source_identity)),
    stock: unique(input.stock.map((row) => row.source_identity)),
    reservation: unique(input.reservations.map((row) => row.source_identity)),
    po_line: unique(poLines.map((row) => row.po_line_id)),
    gate_entry_line: unique(poLines.flatMap((row) => Object.values(row.lifecycle_identities.gate_entry_line_id_by_reference))),
    csn: unique(poLines.flatMap((row) => Object.values(row.lifecycle_identities.csn_id_by_number))),
    po_lot: unique(poLines.flatMap((row) => Object.values(row.lifecycle_identities.lot_id_by_number))),
    sto_csn: unique(input.sto_inbound.map((row) => row.source_identity)),
  });
}

/**
 * Converts read-only, company-scoped evidence into the existing Phase 3A raw
 * input contract.  It does not query a database, mutate documents, choose a
 * group member, net reservations, or compute an allocation.
 */
export function adaptOptimizerPhase3BSources(input: OptimizerPhase3BAdapterInput): OptimizerAdaptedPhase3BSources {
  const companyId = input.company_id;
  const check = (source: string, key: string, rowCompany: string) => assertCompany(companyId, source, key, rowCompany);
  input.demand.forEach((row) => check("DEMAND", row.source_identity, row.company_id));
  input.stock.forEach((row) => check("STOCK", row.source_identity, row.company_id));
  input.reservations.forEach((row) => check("RESERVATION", row.source_identity, row.company_id));
  input.po_lines.forEach((row) => check("PO_LINE", row.source_identity, row.company_id));
  input.sto_inbound.forEach((row) => {
    check("STO_CSN", row.source_identity, row.company_id);
    assertCompany(companyId, "STO_CSN_RECEIVING_COMPANY", row.source_identity, row.receiving_company_id);
  });
  const poLines = collapsePoLineEvidence(input.po_lines);

  const inbound: OptimizerInboundSource[] = [];
  for (const evidence of poLines) {
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
    events.forEach((event) => inbound.push({
      source_key: sourceKey(evidence, event),
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
  const raw: OptimizerRawSources = {
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
    inbound: [...inboundWithUom, ...input.sto_inbound.map(({ source_table: _table, source_identity: _identity, receiving_company_id: _receivingCompanyId, ...row }) => row)],
  };
  return deepFreeze({ raw: deepFreeze(raw), source_identity_manifest: identityManifest(input, poLines) });
}

function isMonthFirst(value: string): boolean {
  return isIsoDate(value) && value.slice(8) === "01";
}

/**
 * Resolves current, effective monthly decisions.  It intentionally accepts a
 * deselected material: that blocks only a future tentative new purchase.  It
 * neither removes its posted stock nor its confirmed inbound evidence.
 */
export function resolveNewBuyEligibility(companyId: string, selectionMonth: string, materialIds: readonly string[], rows: readonly OptimizerMonthlyMaterialSelection[]): OptimizerNewBuyEligibility {
  if (!isMonthFirst(selectionMonth)) throw new Error("Selection month must be an ISO first day of month.");
  const candidates = [...new Set(materialIds.filter(Boolean))].sort();
  if (candidates.length !== materialIds.filter(Boolean).length) throw new Error("New-buy selection candidates must be unique material identities.");
  const seenVersions = new Map<string, OptimizerMonthlyMaterialSelection>();
  const currentByMaterial = new Map<string, OptimizerMonthlyMaterialSelection>();
  for (const row of rows) {
    assertCompany(companyId, "MATERIAL_SELECTION", row.source_key, row.company_id);
    if (!isMonthFirst(row.selection_month)) throw new Error(`Invalid selection month for ${row.source_key}.`);
    const versionKey = `${row.material_id}|${row.selection_month}|${row.version_no}`;
    const prior = seenVersions.get(versionKey);
    if (prior && canonicalJson(prior) !== canonicalJson(row)) throw new Error(`Conflicting duplicate material-selection evidence for ${versionKey}.`);
    seenVersions.set(versionKey, row);
    if (row.selection_month !== selectionMonth || !row.is_current) continue;
    const current = currentByMaterial.get(row.material_id);
    if (current) throw new OptimizerSourceEvidenceConflictError("MATERIAL_SELECTION_CURRENT", `${row.material_id}|${selectionMonth}`);
    currentByMaterial.set(row.material_id, row);
  }
  const decisions = candidates.map((material_id) => {
    const row = currentByMaterial.get(material_id);
    return row
      ? { material_id, state: row.is_selected_for_new_purchase ? "SELECTED" as const : "DESELECTED" as const, selection_version_no: row.version_no, selection_source_key: row.source_key }
      : { material_id, state: "UNKNOWN" as const, selection_version_no: null, selection_source_key: null };
  });
  return deepFreeze({ company_id: companyId, selection_month: selectionMonth, decisions, selected_material_ids: new Set(decisions.filter((decision) => decision.state === "SELECTED").map((decision) => decision.material_id)) });
}

/** Six independent monthly decisions; there is deliberately no carry-forward. */
export function resolveSixMonthNewBuyEligibility(companyId: string, firstMonth: string, materialIds: readonly string[], rows: readonly OptimizerMonthlyMaterialSelection[]): readonly OptimizerNewBuyEligibility[] {
  if (!isMonthFirst(firstMonth)) throw new Error("Six-month selection window must start on an ISO first day of month.");
  const months: string[] = [firstMonth];
  while (months.length < 6) months.push(nextMonth(months[months.length - 1]));
  return deepFreeze(months.map((month) => resolveNewBuyEligibility(companyId, month, materialIds, rows)));
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
export async function createPersistentOptimizerInputSnapshot(raw: OptimizerRawSources, provenance: Omit<OptimizerRunProvenance, "source_contract_version" | "source_tables"> & { source_tables?: readonly string[] }, selectionWindow: readonly OptimizerNewBuyEligibility[] = []): Promise<OptimizerPersistentInputSnapshot> {
  const normalized = normalizeOptimizerSources(raw);
  if (!provenance.captured_at) throw new Error("Snapshot provenance requires captured_at.");
  const supplyEvidence = {
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
  const orderedSelections = [...selectionWindow].sort((a, b) => a.selection_month.localeCompare(b.selection_month));
  if (orderedSelections.some((selection) => selection.company_id !== normalized.company_id)) throw new Error("Selection evidence belongs to a different company than the snapshot.");
  const businessEvidence = { sha256_supply_fingerprint: await sha256(supplyEvidence), selection_window: orderedSelections };
  const completeProvenance: OptimizerRunProvenance = {
    source_contract_version: OPTIMIZER_SOURCE_CONTRACT_VERSION,
    captured_at: provenance.captured_at,
    captured_by: provenance.captured_by,
    adapter_versions: { ...provenance.adapter_versions },
    source_tables: [...(provenance.source_tables ?? Object.values(OPTIMIZER_SOURCE_TABLES).flat())].sort(),
    source_identity_manifest: Object.fromEntries(Object.entries(provenance.source_identity_manifest).map(([key, ids]) => [key, [...new Set(ids)].sort()])),
    source_versions: { ...provenance.source_versions },
  };
  return deepFreeze({ schema_version: 1, normalized, sha256_supply_fingerprint: businessEvidence.sha256_supply_fingerprint, sha256_business_fingerprint: await sha256(businessEvidence), selection_window: orderedSelections, provenance: completeProvenance });
}
