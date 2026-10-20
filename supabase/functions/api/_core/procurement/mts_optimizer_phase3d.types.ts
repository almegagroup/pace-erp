/* PO22 Phase 3D — deterministic, advisory daily coverage contract.
 * Owner decisions D2/D3/D5/D6: common:docs/po22-common/OWNER-DECISIONS-2026-10-19-REQUIREMENT-AND-GROUPS.md
 */

export type OptimizerDailyDemand = Readonly<{
  source_key: string;
  /** null = material-null GROUP_POOL demand; reported per group, never per material. */
  material_id: string | null;
  group_id?: string | null;
  required_by: string | null;
  qty_base: number;
}>;

/** A lifecycle-unique future arrival. It cannot be executable Store stock. */
export type OptimizerConfirmedArrival = Readonly<{
  source_key: string;
  material_id: string;
  /** CSN Tracker plant ETA. A past or missing ETA is assumed to arrive on as_of and flagged (D5). */
  eta_to_plant: string | null;
  qty_base: number;
  lifecycle_kind: "AT_GATE" | "IN_TRANSIT" | "SCHEDULED_LOT" | "PO_REMAINDER" | "STO_IN_TRANSIT" | "SUB_CSN_PLANNED";
}>;

/** Target / Critical days effective from a date (D3: per member material, can change over time). */
export type OptimizerCoveragePolicyVersion = Readonly<{
  effective_from: string;
  target_days: number | null;
  critical_days: number | null;
}>;

export type OptimizerMaterialPlanningPolicy = Readonly<{
  material_id: string;
  /** Used when no dated version applies. */
  target_days: number | null;
  critical_days: number | null;
  /** Optional dated versions; the latest effective_from <= day wins over the plain fields. */
  coverage_versions?: readonly OptimizerCoveragePolicyVersion[];
  /** Vendor minimum and order multiple are separate enforceable constraints (D4). */
  vendor_moq_qty_base: number | null;
  order_multiple_qty_base: number | null;
  /** Optional delivery lot size: one PO may arrive as several lots on separate dates (50 = 25 + 25). */
  delivery_lot_qty_base?: number | null;
  /**
   * Total PO-release to plant-receipt days. When route_lead_time_days is given this is ignored and
   * total = booking_time_days (blank = 0) + route_lead_time_days (D6).
   */
  configured_lead_time_days: number | null;
  booking_time_days?: number | null;
  route_lead_time_days?: number | null;
  /**
   * P2 (owner 2026-10-20): days of cover a lot adds beyond Target — Max days = Target + cycle.
   * Absent / null = legacy rule (restore just above Target).
   */
  cycle_days?: number | null;
  /**
   * P2: every vendor that can supply this material. Each lot picks the cheapest one that arrives
   * in time, else the fastest (a bridge). Its fixed MOQ / multiple / lot are never broken.
   */
  vendor_options?: readonly OptimizerVendorOption[];
}>;

export type OptimizerVendorOption = Readonly<{
  vendor_id: string;
  /** Booking + route; null = unknown (option skipped). */
  lead_time_days: number | null;
  booking_time_days?: number | null;
  moq_qty_base: number | null;
  order_multiple_qty_base: number | null;
  delivery_lot_qty_base?: number | null;
  /** Comparable INR cost per base unit (price × FX + landed); null = unknown (ranked last). */
  unit_cost: number | null;
  /** Best order cycle for this vendor (economic, working-capital aware); null = use policy.cycle_days. */
  cycle_days: number | null;
}>;

/** Members of a group whose demand rows carry this group_id (Method C rule 6). */
export type OptimizerGroupMembers = Readonly<{ group_id: string; member_ids: readonly string[] }>;

export type OptimizerProjectionInput = Readonly<{
  as_of: string;
  horizon_end: string;
  /** Executable posted stock only (R003 / OT01 / OT02 already excluded by the caller, D1). */
  opening_qty_by_material: Readonly<Record<string, number>>;
  daily_demand: readonly OptimizerDailyDemand[];
  confirmed_arrivals: readonly OptimizerConfirmedArrival[];
  policies: readonly OptimizerMaterialPlanningPolicy[];
  /**
   * Method C rule 6 (owner 2026-10-20). When given, a demand row with this group_id is first met
   * each day from the members' projected free stock — above Target days of their own demand,
   * including proposed MOQ/lot excess and confirmed arrivals — most free first (the row's
   * material_id breaks a tie). Only the rest stays on row.material_id (a buy) or, when that is
   * null, a group pool risk.
   */
  groups?: readonly OptimizerGroupMembers[];
}>;

export type OptimizerDailyProjectionRow = Readonly<{
  material_id: string;
  day: string;
  opening_qty_base: number;
  confirmed_arrival_qty_base: number;
  /** Proposed (not ordered) delivery lot arriving this day. */
  planned_lot_qty_base: number;
  demand_qty_base: number;
  /** Part of demand_qty_base that is group demand met from this material's free stock (rule 6). */
  group_draw_qty_base: number;
  closing_qty_base: number;
  /** Whole days the closing balance covers (sheet "Max Days"). */
  max_cover_days: number | null;
  /** Closing without this day's arrival and lot (sheet "Min Stock") and its cover (sheet "Min Days"). */
  min_stock_qty_base: number;
  min_cover_days: number | null;
  target_days: number | null;
  critical_days: number | null;
  /** Arrival is projected supply only; false prevents a Store instruction. */
  executable_arrival: false;
}>;

export type OptimizerArrivalFlag = Readonly<{
  source_key: string;
  material_id: string;
  eta_to_plant: string | null;
  assumed_eta: string;
  reason: "ETA_PASSED" | "ETA_MISSING";
  message: string;
}>;

export type OptimizerMaterialRisk = Readonly<{
  material_id: string;
  first_shortage_day: string | null;
  first_below_critical_day: string | null;
  first_below_target_day: string | null;
  projected_closing_qty_base: number;
}>;

/** Material-null group-pool demand not allocated to any material, per group. */
export type OptimizerGroupPoolRisk = Readonly<{
  group_id: string | null;
  unresolved_qty_base: number;
  first_day: string | null;
}>;

export type OptimizerPlannedLot = Readonly<{ lot_no: number; plant_eta: string; qty_base: number }>;

export type OptimizerAdvisoryBuy = Readonly<{
  material_id: string;
  /** 1-based recommendation sequence for the material inside the horizon (0 for non-buy statuses). */
  sequence: number;
  required_qty_base: number;
  recommended_po_qty_base: number | null;
  recommended_po_by: string | null;
  estimated_plant_eta: string | null;
  /** Day the cover falls to Target — when the material is needed (null for non-buy statuses). */
  need_date: string | null;
  lots: readonly OptimizerPlannedLot[];
  total_lead_time_days: number | null;
  status: "NO_BUY" | "UNKNOWN_POLICY" | "UNKNOWN_LEAD_TIME" | "ADVISORY" | "ADVISORY_LATE";
  reason: string;
  advisory_only: true;
  /** P2: vendor chosen for this lot (vendor_options); absent = legacy single vendor. */
  vendor_id?: string | null;
  /** P2: cover the order is sized to (Target + cycle). */
  max_cover_days?: number | null;
  /** P2: a faster, costlier vendor because the cheapest one cannot arrive in time. */
  bridge?: boolean;
  /** P2: the cheapest vendor that would have been used if there were time. */
  cheapest_vendor_id?: string | null;
}>;

export type OptimizerProjectionResult = Readonly<{
  rows: readonly OptimizerDailyProjectionRow[];
  risks: readonly OptimizerMaterialRisk[];
  group_pool_risks: readonly OptimizerGroupPoolRisk[];
  arrival_flags: readonly OptimizerArrivalFlag[];
  advisory_buys: readonly OptimizerAdvisoryBuy[];
}>;
