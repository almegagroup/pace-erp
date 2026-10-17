/*
 * Phase 3A only: immutable, database-free input contract for the future PO22
 * optimizer. This is deliberately separate from mts_requirement.logic.ts;
 * it neither changes nor invokes the approved PO22 requirement calculation.
 */

export type OptimizerMissingDataCode =
  | "MISSING_UOM_CONVERSION"
  | "INVALID_QUANTITY"
  | "UNKNOWN_ETA"
  | "DUPLICATE_STOCK_EVENT"
  | "DUPLICATE_INBOUND_EVENT";

export type OptimizerMissingData = {
  code: OptimizerMissingDataCode;
  source: "DEMAND" | "STOCK" | "RESERVATION" | "INBOUND";
  source_key: string;
  message: string;
  material_id: string | null;
};

export type OptimizerMaterialUom = {
  material_id: string;
  base_uom_code: string;
  /** One source UOM equals this many base units; base UOM is always 1. */
  to_base_factors: Record<string, number>;
};

export type OptimizerDemandSource = {
  source_key: string;
  company_id: string;
  product_id: string;
  source_line_id: string;
  required_by: string | null;
  demand_kind: "FIXED_EXCLUSIVE" | "GROUP_POOL";
  group_id: string | null;
  material_id: string | null;
  qty: number;
  uom_code: string;
};

export type OptimizerStockSource = {
  source_key: string;
  company_id: string;
  material_id: string;
  storage_location_id: string;
  stock_type_code: string;
  qty: number;
  uom_code: string;
  posted_at: string;
};

export type OptimizerReservationSource = {
  source_key: string;
  company_id: string;
  material_id: string;
  storage_location_id: string;
  qty: number;
  uom_code: string;
  status: string;
};

export type OptimizerInboundSource = {
  /** Lifecycle-unique physical event key; PO header/CSN number alone is insufficient. */
  source_key: string;
  company_id: string;
  material_id: string;
  qty: number;
  uom_code: string;
  eta_to_plant: string | null;
  lifecycle_kind: "AT_GATE" | "IN_TRANSIT" | "SCHEDULED_LOT" | "PO_REMAINDER";
  reference: string;
};

export type OptimizerRawSources = {
  company_id: string;
  as_of: string;
  captured_at: string;
  materials: OptimizerMaterialUom[];
  demand: OptimizerDemandSource[];
  stock: OptimizerStockSource[];
  reservations: OptimizerReservationSource[];
  inbound: OptimizerInboundSource[];
};

export type OptimizerDemandInput = Omit<OptimizerDemandSource, "qty" | "uom_code"> & {
  qty_base: number | null;
  base_uom_code: string | null;
};
export type OptimizerStockInput = Omit<OptimizerStockSource, "qty" | "uom_code"> & {
  qty_base: number | null;
  base_uom_code: string | null;
};
export type OptimizerReservationInput = Omit<OptimizerReservationSource, "qty" | "uom_code"> & {
  qty_base: number | null;
  base_uom_code: string | null;
};
export type OptimizerInboundInput = Omit<OptimizerInboundSource, "qty" | "uom_code"> & {
  qty_base: number | null;
  base_uom_code: string | null;
};

/** Immutable normalized evidence. Future solver runs must consume this, not live rows. */
export type OptimizerInputSnapshot = {
  schema_version: 1;
  company_id: string;
  as_of: string;
  captured_at: string;
  source_fingerprint: string;
  demand: readonly OptimizerDemandInput[];
  stock: readonly OptimizerStockInput[];
  reservations: readonly OptimizerReservationInput[];
  inbound: readonly OptimizerInboundInput[];
  missing_data: readonly OptimizerMissingData[];
};

export class OptimizerSourceScopeError extends Error {
  constructor(public readonly source: string, public readonly sourceKey: string, expectedCompany: string, actualCompany: string) {
    super(`${source} ${sourceKey} belongs to ${actualCompany}, not requested company ${expectedCompany}.`);
    this.name = "OptimizerSourceScopeError";
  }
}
