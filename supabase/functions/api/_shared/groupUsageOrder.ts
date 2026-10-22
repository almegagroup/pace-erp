/*
 * File-Path: supabase/functions/api/_shared/groupUsageOrder.ts
 * Purpose: Loads PO22 Group Settings (erp_planning.material_group_usage_order) for one company.
 *          Pure ordering lives in groupUsageOrder.logic.ts.
 */
import { serviceRoleClient } from "./serviceRoleClient.ts";
import { effectiveGroupUsageOrders, type GroupUsageOrder } from "./groupUsageOrder.logic.ts";

export type GroupUsageOrderRow = {
  material_group_id: string;
  effective_from: string;
  version_no: number;
  order_mode: string;
  member_order: string[];
  remarks: string | null;
  created_by: string;
  created_at: string;
};

/** Every current (non-superseded) setting row of the company, all effective dates. */
export async function loadGroupUsageOrderRows(companyId: string): Promise<GroupUsageOrderRow[]> {
  const { data, error } = await serviceRoleClient.schema("erp_planning").from("material_group_usage_order")
    .select("material_group_id, effective_from, version_no, order_mode, member_order, remarks, created_by, created_at")
    .eq("company_id", companyId).eq("is_current", true)
    .order("effective_from", { ascending: true }).range(0, 4999);
  if (error) {
    console.error("[groupUsageOrder] load failed:", JSON.stringify(error));
    throw new Error("GROUP_USAGE_ORDER_LOAD_FAILED");
  }
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    material_group_id: String(row.material_group_id ?? ""),
    effective_from: String(row.effective_from ?? "").slice(0, 10),
    version_no: Number(row.version_no ?? 1),
    order_mode: String(row.order_mode ?? ""),
    member_order: Array.isArray(row.member_order) ? (row.member_order as unknown[]).map(String) : [],
    remarks: row.remarks ? String(row.remarks) : null,
    created_by: String(row.created_by ?? ""),
    created_at: String(row.created_at ?? ""),
  }));
}

/** Group → setting in force on asOf (YYYY-MM-DD). Groups without a setting are absent. */
export async function loadGroupUsageOrders(companyId: string, asOf: string): Promise<Map<string, GroupUsageOrder>> {
  return effectiveGroupUsageOrders(await loadGroupUsageOrderRows(companyId), asOf);
}
