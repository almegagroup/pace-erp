/* PO22 Phase 3C — deterministic current-stock allocation contract.
 * This module has no database I/O, no PO creation and no stock posting.
 */
import type { OptimizerInputSnapshot } from "./mts_optimizer_input.types.ts";

export type OptimizerGroupMember = Readonly<{
  /** The particular GROUP_POOL demand source this formulation membership serves. */
  demand_source_key: string;
  group_id: string;
  material_id: string;
  active: boolean;
  /** Immutable source-line/member identity, never a material-only synthetic key. */
  source_key: string;
}>;

export type OptimizerAllocationInput = Readonly<{
  snapshot: OptimizerInputSnapshot;
  /** Active formulation/BOM membership for each material-null GROUP_POOL. */
  group_members: readonly OptimizerGroupMember[];
}>;

export type OptimizerAllocationException = Readonly<{
  code:
    | "DEMAND_NOT_NORMALIZED"
    | "FIXED_MATERIAL_MISSING"
    | "GROUP_ID_MISSING"
    | "NO_ACTIVE_GROUP_MEMBER"
    | "GROUP_MEMBER_UOM_MISMATCH"
    | "MATERIAL_EXECUTABLE_STOCK_BLOCKED";
  source_key: string;
  material_id: string | null;
  message: string;
}>;

export type OptimizerAllocationRow = Readonly<{
  demand_source_key: string;
  product_id: string;
  source_line_id: string;
  required_by: string | null;
  demand_kind: "FIXED_EXCLUSIVE" | "GROUP_POOL";
  group_id: string | null;
  /** Null is reserved for residual GROUP_POOL shortage; never a default member. */
  material_id: string | null;
  base_uom_code: string | null;
  required_qty_base: number;
  executable_qty_base: number;
  uncovered_qty_base: number;
  allocation_state: "ALLOCATED" | "PARTIAL" | "UNALLOCATED" | "BLOCKED";
  executable: true;
  reason: string | null;
}>;

export type OptimizerMaterialBalance = Readonly<{
  material_id: string;
  base_uom_code: string;
  posted_eligible_qty_base: number;
  reservation_qty_base: number;
  executable_opening_qty_base: number;
  executable_allocated_qty_base: number;
  executable_closing_qty_base: number;
  executable_stock_blocked: boolean;
}>;

export type OptimizerProjectedInbound = Readonly<{
  source_key: string;
  material_id: string;
  qty_base: number;
  base_uom_code: string;
  eta_to_plant: string;
  /** Explicitly false: this is coverage evidence, not a Store allocation. */
  executable: false;
}>;

export type OptimizerAllocationResult = Readonly<{
  company_id: string;
  as_of: string;
  source_fingerprint: string;
  rows: readonly OptimizerAllocationRow[];
  material_balances: readonly OptimizerMaterialBalance[];
  projected_inbound: readonly OptimizerProjectedInbound[];
  exceptions: readonly OptimizerAllocationException[];
}>;
