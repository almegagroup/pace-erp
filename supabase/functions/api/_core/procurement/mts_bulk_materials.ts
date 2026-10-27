/*
 * Bulk RM (owner 2026-10-26/27): Bulk / Standard / Tanker is decided by the PO type (`purchase_order.delivery_type`);
 * the CRCP flag does not change it. PO22 leaves Bulk RM out for now.
 *   - A material this company buys on a BULK PO (not cancelled) is Bulk.
 *   - A material this company has POs for, but only Standard / Tanker ones, is NOT Bulk here.
 *   - A material this company has no PO for yet (Jayashree's Dolomite 240#) follows the other companies' BULK POs.
 */
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { classifyBulkMaterials } from "./mts_bulk_rule.ts";
export { bulkOnlyGroupIds, classifyBulkMaterials } from "./mts_bulk_rule.ts";

type JsonRecord = Record<string, unknown>;

async function materialsOnPos(poIds: string[]): Promise<Set<string>> {
  if (poIds.length === 0) return new Set();
  const lines = await fetchInChunks<JsonRecord>(poIds, (chunk) => serviceRoleClient
    .schema("erp_procurement").from("purchase_order_line").select("material_id").in("po_id", chunk));
  return new Set(lines.map((row) => String(row.material_id ?? "")).filter(Boolean));
}

export async function loadBulkMaterialIds(companyId: string): Promise<Set<string>> {
  const pos = await serviceRoleClient.schema("erp_procurement").from("purchase_order").select("id, company_id, delivery_type")
    .neq("status", "CANCELLED").limit(20000);
  if (pos.error) throw new Error("MTS_BULK_LOAD_FAILED");
  const rows = (pos.data ?? []) as JsonRecord[];
  const own = rows.filter((row) => String(row.company_id ?? "") === companyId);
  const ids = (list: JsonRecord[]) => list.map((row) => String(row.id ?? ""));
  const [ownBulk, ownAnyPo, otherBulk] = await Promise.all([
    materialsOnPos(ids(own.filter((row) => row.delivery_type === "BULK"))),
    materialsOnPos(ids(own)),
    materialsOnPos(ids(rows.filter((row) => String(row.company_id ?? "") !== companyId && row.delivery_type === "BULK"))),
  ]);
  return classifyBulkMaterials({ ownBulk, ownAnyPo, otherBulk });
}
