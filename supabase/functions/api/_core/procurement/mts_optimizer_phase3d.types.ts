/* PO22 Phase 3D — deterministic, advisory daily coverage contract. */

export type OptimizerDailyDemand = Readonly<{
  source_key: string;
  material_id: string | null;
  required_by: string | null;
  qty_base: number;
}>;

/** A lifecycle-unique future arrival. It cannot be executable Store stock. */
export type OptimizerConfirmedArrival = Readonly<{
  source_key: string;
  material_id: string;
  eta_to_plant: string | null;
  qty_base: number;
  lifecycle_kind: "AT_GATE" | "IN_TRANSIT" | "SCHEDULED_LOT" | "PO_REMAINDER";
}>;

export type OptimizerMaterialPlanningPolicy = Readonly<{
  material_id: string;
  target_days: number | null;
  critical_days: number | null;
  /** Vendor minimum and order multiple are separate enforceable constraints. */
  vendor_moq_qty_base: number | null;
  order_multiple_qty_base: number | null;
  /** Already includes vendor processing and delivery to plant. */
  configured_lead_time_days: number | null;
}>;

export type OptimizerProjectionInput = Readonly<{
  as_of: string;
  horizon_end: string;
  opening_qty_by_material: Readonly<Record<string, number>>;
  daily_demand: readonly OptimizerDailyDemand[];
  confirmed_arrivals: readonly OptimizerConfirmedArrival[];
  policies: readonly OptimizerMaterialPlanningPolicy[];
}>;

export type OptimizerDailyProjectionRow = Readonly<{
  material_id: string;
  day: string;
  opening_qty_base: number;
  confirmed_arrival_qty_base: number;
  demand_qty_base: number;
  closing_qty_base: number;
  /** Arrival is projected supply only; false prevents a Store instruction. */
  executable_arrival: false;
}>;

export type OptimizerMaterialRisk = Readonly<{
  material_id: string;
  first_shortage_day: string | null;
  first_below_critical_day: string | null;
  first_below_target_day: string | null;
  projected_closing_qty_base: number;
  unresolved_group_pool_qty_base: number;
}>;

export type OptimizerAdvisoryBuy = Readonly<{
  material_id: string;
  required_qty_base: number;
  recommended_po_qty_base: number | null;
  recommended_po_by: string | null;
  estimated_plant_eta: string | null;
  status: "NO_BUY" | "UNKNOWN_POLICY" | "UNKNOWN_LEAD_TIME" | "ADVISORY";
  reason: string;
  advisory_only: true;
}>;

export type OptimizerProjectionResult = Readonly<{
  rows: readonly OptimizerDailyProjectionRow[];
  risks: readonly OptimizerMaterialRisk[];
  advisory_buys: readonly OptimizerAdvisoryBuy[];
}>;
