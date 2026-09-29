// §119/Q1-2026-09-29 (business owner) — SAP MB1B/MIGO blocks EVERY movement type against a
// material+plant+storage-location(+batch) combination the moment it's under an active Physical
// Inventory count, regardless of which transaction is trying to post. Our own implementation only
// ever wired this check into a handful of handlers (GRN, SO/STO dispatch via
// sales_order.handlers.ts, RTV, Delivery Order) — Process PO, Packing PO, Inward QA, Opening
// Stock, PTO, and Location Transfer never called it at all. This is the single shared
// implementation every caller must use from here on, so the check can never again drift out of
// sync between callers (previously it was hand-copied into grn.handlers.ts and
// sales_order.handlers.ts separately).
//
// Known limitation, inherited from the original implementation (not new here): the check is
// material+storage_location+stock_type only, not batch-aware, even though
// physical_inventory_block rows for batch-tracked SFG/FG do carry a batch_number. This means a
// PID counting ONE batch at a location blocks EVERY batch of that material at that location —
// broader than SAP (which is batch-precise), but safe in the direction that matters (never
// UNDER-blocks). Tightening this to be batch-aware is a separate, deliberate follow-up — not
// something to slip in silently while just extending coverage to new callers.
import { serviceRoleClient } from "./serviceRoleClient.ts";

export async function hasPhysicalInventoryBlock(
  materialId: string,
  storageLocationId: string,
  stockType: string,
): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("physical_inventory_block")
    .select("id")
    .eq("material_id", materialId)
    .eq("storage_location_id", storageLocationId)
    .eq("stock_type", stockType)
    .maybeSingle();
  if (error) throw new Error("MATERIAL_POSTING_BLOCK_LOOKUP_FAILED");
  return Boolean(data?.id);
}

// Convenience for handlers that need to check several (material, storage_location, stock_type)
// combinations before writing anything (e.g. every RM/PM/INT line in a Process PO Standard/Final
// save) — returns the first blocked combo found, or null if none are blocked. Deliberately
// sequential (small, bounded list — a PO's own line count — not worth parallelizing per §8B).
export async function findFirstPhysicalInventoryBlock(
  combos: Array<{ materialId: string; storageLocationId: string; stockType: string }>,
): Promise<{ materialId: string; storageLocationId: string; stockType: string } | null> {
  for (const combo of combos) {
    if (!combo.materialId || !combo.storageLocationId || !combo.stockType) continue;
    const blocked = await hasPhysicalInventoryBlock(combo.materialId, combo.storageLocationId, combo.stockType);
    if (blocked) return combo;
  }
  return null;
}
