/*
 * Bulk RM (owner 2026-10-26/27): a material bought on Bulk delivery POs (purchase_order.delivery_type = BULK, not
 * cancelled) by ANY company. Bulk is a property of the material, not of one company: Dolomite 240# is Bulk at CMP003
 * / CMP005, so it is Bulk for CMP011 (Jayashree) too even though CMP011 has no PO for it. PO22 leaves these out for now.
 */
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";

type JsonRecord = Record<string, unknown>;

export async function loadBulkMaterialIds(_companyId?: string): Promise<Set<string>> {
  const bulkPos = await serviceRoleClient.schema("erp_procurement").from("purchase_order").select("id")
    .eq("delivery_type", "BULK").neq("status", "CANCELLED").limit(10000);
  if (bulkPos.error) throw new Error("MTS_BULK_LOAD_FAILED");
  const poIds = ((bulkPos.data ?? []) as JsonRecord[]).map((row) => String(row.id ?? ""));
  if (poIds.length === 0) return new Set();
  const lines = await fetchInChunks<JsonRecord>(poIds, (chunk) => serviceRoleClient
    .schema("erp_procurement").from("purchase_order_line").select("material_id").in("po_id", chunk));
  return new Set(lines.map((row) => String(row.material_id ?? "")).filter(Boolean));
}

/** Groups whose every active member is Bulk: they are left out together with their members. */
export function bulkOnlyGroupIds(
  groupMembers: ReadonlyMap<string, ReadonlyArray<{ material_id: string; active: boolean }>>,
  bulk: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  for (const [groupId, members] of groupMembers) {
    const active = members.filter((m) => m.active);
    if (active.length > 0 && active.every((m) => bulk.has(m.material_id))) ids.push(groupId);
  }
  return ids;
}
