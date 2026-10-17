/*
 * PO22 Phase 3B: source-adapter and persistence contracts only.
 *
 * These types deliberately do not expose an allocation, recommended purchase,
 * Store issue, transfer, or PO-creation operation.  They are an additive
 * boundary around the approved PO22 requirement engine.
 */

import type {
  OptimizerDemandSource,
  OptimizerInboundSource,
  OptimizerRawSources,
  OptimizerReservationSource,
  OptimizerStockSource,
} from "./mts_optimizer_input.types.ts";
import type { PoLineInboundInput } from "./mts_requirement.logic.ts";

export const OPTIMIZER_SOURCE_CONTRACT_VERSION = "phase-3b-1";

/**
 * Auditable table/column contracts.  They are not a claim that a live query
 * has verified every row; the adapter marks unsupported/missing evidence.
 */
export const OPTIMIZER_SOURCE_TABLES = {
  demand: [
    "erp_planning.customer_plan_line(id, company_id, product_id, plan_month, version_type, qty)",
    "erp_production.stroke_master(id, prodshade_material_id, stroke_number)",
    "erp_production.stroke_line(id, stroke_master_id, material_id, material_group_id, dosage_pct, default_storage_location_id)",
    "erp_production.pack_bom(id, company_id, product_id, status)",
    "erp_production.pack_bom_line(pack_bom_id, material_id, material_group_id, qty, uom_code, storage_location_id)",
    "erp_master.material_category_group_member(material_group_id, material_id, active)",
  ],
  stock: [
    "erp_inventory.get_stock_history(p_company_id, p_from_date, p_to_date, p_material_type_codes, p_material_ids, p_storage_location_ids)",
    "erp_inventory.storage_location_master(id, company_id, storage_location_code, active)",
    "erp_inventory.storage_location_plant_map(storage_location_id, company_id)",
    "erp_production.reservation_document(id, company_id, material_id, storage_location_id, balance_qty, status)",
  ],
  inbound: [
    "erp_procurement.purchase_order(id, company_id, po_number, status, expected_delivery_date, order_in_lot)",
    "erp_procurement.purchase_order_line(id, po_id, line_number, material_id, ordered_qty, ordered_qty_base_uom, po_uom_code, open_qty, line_status)",
    "erp_procurement.gate_entry_line(po_line_id, gate_entry_id, ge_qty, uom_code, grn_posted)",
    "erp_procurement.gate_entry(id, ge_number, ge_date, status)",
    "erp_procurement.consignment_note(id, po_line_id, mother_csn_id, csn_number, status, dispatch_qty, total_received_qty, eta_to_plant_calculated, consignee_company_id)",
    "erp_procurement.po_lot_balances(p_po_line_ids, p_exclude_ge_line_id)",
  ],
  material: [
    "erp_master.material_master(id, base_uom_code, material_type)",
    "erp_master.material_uom_conversion(material_id, from_uom_code, to_uom_code, conversion_factor, active, variable_conversion)",
  ],
} as const;

/** A source row already extracted with only fields verified for this contract. */
export type OptimizerCompanyEvidence<T extends { company_id: string }> = T & {
  source_table: string;
  source_identity: string;
};

export type OptimizerDemandEvidence = OptimizerCompanyEvidence<OptimizerDemandSource>;
export type OptimizerStockEvidence = OptimizerCompanyEvidence<OptimizerStockSource>;
export type OptimizerReservationEvidence = OptimizerCompanyEvidence<OptimizerReservationSource>;

/** Physical source identifiers required to make inbound evidence repeat-safe. */
export type OptimizerPoLifecycleIdentities = {
  po_line_id: string;
  /** Keyed by the matching `PoLineInboundInput.at_gate[].reference` value. */
  gate_entry_line_id_by_reference: Readonly<Record<string, string>>;
  /** CSN/sub-CSN document IDs keyed by their `csn_number`. */
  csn_id_by_number: Readonly<Record<string, string>>;
  /** Lot record IDs keyed by their `lot_number`. */
  lot_id_by_number: Readonly<Record<string, string>>;
};

export type OptimizerPoLineEvidence = OptimizerCompanyEvidence<{
  company_id: string;
  po_line_id: string;
  line: PoLineInboundInput;
  lifecycle_identities: OptimizerPoLifecycleIdentities;
}>;

/** Existing cross-company STO CSNs are projected inbound, never Store stock. */
export type OptimizerStoInboundEvidence = OptimizerCompanyEvidence<OptimizerInboundSource> & {
  receiving_company_id: string;
};

export type OptimizerPhase3BAdapterInput = Omit<OptimizerRawSources, "demand" | "stock" | "reservations" | "inbound"> & {
  demand: readonly OptimizerDemandEvidence[];
  stock: readonly OptimizerStockEvidence[];
  reservations: readonly OptimizerReservationEvidence[];
  /** PO/GE/CSN/sub-CSN/lot evidence is partitioned once by PO line. */
  po_lines: readonly OptimizerPoLineEvidence[];
  /** Only incoming STO CSNs already destined for this company. */
  sto_inbound: readonly OptimizerStoInboundEvidence[];
};

/** Monthly human selection is a new-buy gate only, not an inventory filter. */
export type OptimizerMonthlyMaterialSelection = {
  company_id: string;
  material_id: string;
  selection_month: string; // ISO first day of month
  is_selected_for_new_purchase: boolean;
  version_no: number;
  is_current: boolean;
  source_key: string;
};

export type OptimizerNewBuyDecision = {
  readonly material_id: string;
  readonly state: "SELECTED" | "DESELECTED" | "UNKNOWN";
  readonly selection_version_no: number | null;
  readonly selection_source_key: string | null;
};

export type OptimizerSourceIdentityManifest = Readonly<Record<string, readonly string[]>>;

export type OptimizerRunProvenance = {
  source_contract_version: typeof OPTIMIZER_SOURCE_CONTRACT_VERSION;
  captured_at: string;
  captured_by: string | null;
  adapter_versions: Readonly<Record<string, string>>;
  source_tables: readonly string[];
  /** Actual source row/document identities, sorted and retained for audit. */
  source_identity_manifest: OptimizerSourceIdentityManifest;
  /** Source schema/query versions when available; absence is explicit upstream. */
  source_versions: Readonly<Record<string, string>>;
};

export type OptimizerPersistentInputSnapshot = {
  readonly schema_version: 1;
  readonly normalized: ReturnType<(typeof import("./mts_optimizer_input.logic.ts"))["normalizeOptimizerSources"]>;
  /** SHA-256 over normalized source/supply evidence only. */
  readonly sha256_supply_fingerprint: string;
  /** SHA-256 over supply evidence plus six-month manual selection decisions. */
  readonly sha256_business_fingerprint: string;
  readonly selection_window: readonly OptimizerNewBuyEligibility[];
  readonly provenance: Readonly<OptimizerRunProvenance>;
};

export type OptimizerNewBuyEligibility = {
  readonly company_id: string;
  readonly selection_month: string;
  readonly decisions: readonly OptimizerNewBuyDecision[];
  readonly selected_material_ids: ReadonlySet<string>;
};

export type OptimizerAdaptedPhase3BSources = {
  readonly raw: OptimizerRawSources;
  readonly source_identity_manifest: OptimizerSourceIdentityManifest;
};

export class OptimizerSourceEvidenceConflictError extends Error {
  constructor(public readonly source: string, public readonly identity: string) {
    super(`Conflicting duplicate ${source} evidence for ${identity}.`);
    this.name = "OptimizerSourceEvidenceConflictError";
  }
}

export class OptimizerSourceIdentityError extends Error {
  constructor(public readonly source: string, public readonly identity: string) {
    super(`Missing verified ${source} lifecycle identity for ${identity}.`);
    this.name = "OptimizerSourceIdentityError";
  }
}
