// §119/Q1-2026-09-29 (business owner) — SAP MB1B/MIGO blocks EVERY movement type against a
// material+plant+storage-location(+batch) combination the moment it's under an active Physical
// Inventory count, regardless of which transaction is trying to post. Our own implementation only
// ever wired this check into a handful of handlers (GRN, SO/STO dispatch via
// sales_order.handlers.ts, RTV, Delivery Order) — Process PO, Packing PO, Inward QA, Opening
// Stock, PTO, and Location Transfer never called it at all. This is the single shared
// implementation every caller must use from here on, so the check can never again drift out of
// sync between callers (previously it was hand-copied into grn.handlers.ts and
// sales_order.handlers.ts separately).
import { serviceRoleClient } from "./serviceRoleClient.ts";

// Found live 2026-09-30 (business owner): erp_inventory.storage_location_master carries no
// company_id at all — a location code like "R003" is shared/reused across sister companies
// that share a physical site (stock_snapshot/stock_ledger are what actually separate each
// company's stock at that same storage_location_id). physical_inventory_block itself only
// gained a company_id column in the same fix (migration 20260930120000) — every lookup here
// MUST be scoped by the acting company, or a PID opened in one company spuriously blocks (or,
// via the old unique indexes, outright prevents) every other company sharing that location code.

// Material+location+stock-type only, no batch filter — matches ANY block row for this
// combination regardless of what batch (or no batch) it was registered under. Correct and
// exact (not just "safe") for RM/PM/INT: those PID items are always blended (no batch
// dimension), so their block rows always carry batch_number=NULL, and "any batch" / "batch
// IS NULL" are the same set for them. Every pre-existing caller (GRN/SO/RTV/DO/PTO/Location
// Transfer/Stock Status Change/Inward QA/Opening Stock) and every RM/PM/INT check added
// since keeps using this one, unchanged.
export async function hasPhysicalInventoryBlock(
  companyId: string,
  materialId: string,
  storageLocationId: string,
  stockType: string,
): Promise<boolean> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("physical_inventory_block")
    .select("id")
    .eq("company_id", companyId)
    .eq("material_id", materialId)
    .eq("storage_location_id", storageLocationId)
    .eq("stock_type", stockType)
    .maybeSingle();
  if (error) throw new Error("MATERIAL_POSTING_BLOCK_LOOKUP_FAILED");
  return Boolean(data?.id);
}

// §Q1-batch-precision-2026-09-29 (business owner) — SAP blocks by the EXACT batch under
// count, not by "any batch of this material at this location." Our own PID for
// batch-tracked SFG/FG (MTO/HPS/MTEST) already captures batch_number (and, for FG,
// packing_order_id) per item — MI04/MI05 show Batch Number/Packing PO Number as a fixed,
// uneditable identity for these lines, exactly mirroring how physical_inventory_block
// itself stores batch_number per block row (confirmed in physical_inventory.handlers.ts's
// buildUniquePIBlockPayload — candidate.batch_number is written straight onto the block
// row). Blocking EVERY batch of a material just because ONE batch is being counted would
// be broader than SAP itself and a real operational risk during a live count: a Packing PO
// drawing from a completely different, uncounted batch at the same storage location would
// be wrongly refused.
//
// Use this ONLY where the caller genuinely knows which specific batch identity it is about
// to post against — the SFG/FG side of Process PO Verify/COR6/CORS and Packing PO
// Final/COR6/CORS/PR19. RM/PM/INT stay on the plain hasPhysicalInventoryBlock() above:
// their PID items are always blended/batch-less, so passing a batch here would be
// meaningless for them (and, if that batch happened to be a non-null traceability tag
// rather than a real PID batch identity, actively wrong — it would look for a
// batch-specific block that can never exist for a blended material, silently failing to
// find a real blended block that DOES exist).
//
// batchNumber=null means "match a blended block" (IS NULL), not "match anything" — pass
// null explicitly for a batch-tracked material whose OWN po_type is itself blended (INT
// process output, MTS process/packing orders) so it correctly matches how the PID itself
// registered that item.
export async function hasPhysicalInventoryBlockForBatch(
  companyId: string,
  materialId: string,
  storageLocationId: string,
  stockType: string,
  batchNumber: string | null,
): Promise<boolean> {
  let query = serviceRoleClient
    .schema("erp_inventory")
    .from("physical_inventory_block")
    .select("id")
    .eq("company_id", companyId)
    .eq("material_id", materialId)
    .eq("storage_location_id", storageLocationId)
    .eq("stock_type", stockType);
  query = batchNumber ? query.eq("batch_number", batchNumber) : query.is("batch_number", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("MATERIAL_POSTING_BLOCK_LOOKUP_FAILED");
  return Boolean(data?.id);
}

export interface PhysicalInventoryBlockCombo {
  materialId: string;
  storageLocationId: string;
  stockType: string;
  // Omit this key entirely for an RM/PM/INT-style "any batch" check (hasPhysicalInventoryBlock).
  // Include it (even as null, for a blended-po_type SFG/FG item) for a batch-precise check
  // (hasPhysicalInventoryBlockForBatch) — see that function's own comment for why the two are
  // not interchangeable.
  batchNumber?: string | null;
}

// Convenience for handlers that need to check several combinations before writing anything
// (e.g. every RM/PM/INT + SFG/FG line in a Packing PO Final save) — returns the first blocked
// combo found, or null if none are blocked. Deliberately sequential (small, bounded list — a
// PO's own line count — not worth parallelizing per §8B). companyId is a single value because
// every combo in one call always belongs to the same acting company/handler invocation.
export async function findFirstPhysicalInventoryBlock(
  companyId: string,
  combos: PhysicalInventoryBlockCombo[],
): Promise<PhysicalInventoryBlockCombo | null> {
  for (const combo of combos) {
    if (!combo.materialId || !combo.storageLocationId || !combo.stockType) continue;
    const blocked = "batchNumber" in combo
      ? await hasPhysicalInventoryBlockForBatch(companyId, combo.materialId, combo.storageLocationId, combo.stockType, combo.batchNumber ?? null)
      : await hasPhysicalInventoryBlock(companyId, combo.materialId, combo.storageLocationId, combo.stockType);
    if (blocked) return combo;
  }
  return null;
}
