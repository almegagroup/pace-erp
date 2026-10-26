import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { calculatePackingOrderFoCapacity, type PackingOrderFoCapacity } from "./packing_order_fo_capacity.ts";

type JsonRecord = Record<string, unknown>;

type PackingOrderQty = {
  id: string;
  actual_qty_kg?: unknown;
  planned_qty_kg?: unknown;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function outputQty(row: PackingOrderQty): number {
  return Number(row.actual_qty_kg) || Number(row.planned_qty_kg) || 0;
}

// Loads the actual dispatch identity as well as the aggregate quantity. A DO
// linked through SO Map retains its FO id, which lets the pure calculator
// release that FO's reservation instead of subtracting the same stock twice.
export async function fetchPackingOrderFoCapacities(
  packingOrders: PackingOrderQty[],
): Promise<Map<string, PackingOrderFoCapacity>> {
  const poById = new Map(packingOrders.map((row) => [text(row.id), row] as const).filter(([id]) => Boolean(id)));
  const packingOrderIds = [...poById.keys()];
  if (packingOrderIds.length === 0) return new Map();

  const [allocationRows, dcRows] = await Promise.all([
    fetchInChunks<JsonRecord>(packingOrderIds, (idChunk) => serviceRoleClient
      .schema("erp_production").from("plan_feed_packing_order_allocation")
      .select("packing_order_id, plan_feed_id, allocated_qty_kg").in("packing_order_id", idChunk)),
    fetchInChunks<JsonRecord>(packingOrderIds, (idChunk) => serviceRoleClient
      .schema("erp_procurement").from("delivery_challan_line")
      .select("packing_order_id, quantity, so_map_allocation_id, delivery_challan!inner(status)")
      .in("packing_order_id", idChunk).neq("delivery_challan.status", "CANCELLED")),
  ]);

  const soMapAllocationIds = [...new Set(dcRows.map((row) => text(row.so_map_allocation_id)).filter(Boolean))];
  const foBySoMapAllocationId = new Map<string, string>();
  if (soMapAllocationIds.length > 0) {
    const soMapRows = await fetchInChunks<JsonRecord>(soMapAllocationIds, (idChunk) => serviceRoleClient
      .schema("erp_procurement").from("sales_order_map_allocation")
      .select("id, fo_id").in("id", idChunk));
    for (const row of soMapRows) foBySoMapAllocationId.set(text(row.id), text(row.fo_id));
  }

  const allocationsByPo = new Map<string, JsonRecord[]>();
  for (const row of allocationRows) {
    const packingOrderId = text(row.packing_order_id);
    if (!allocationsByPo.has(packingOrderId)) allocationsByPo.set(packingOrderId, []);
    allocationsByPo.get(packingOrderId)?.push(row);
  }
  const dispatchesByPo = new Map<string, JsonRecord[]>();
  for (const row of dcRows) {
    const packingOrderId = text(row.packing_order_id);
    if (!dispatchesByPo.has(packingOrderId)) dispatchesByPo.set(packingOrderId, []);
    dispatchesByPo.get(packingOrderId)?.push(row);
  }

  return new Map([...poById.entries()].map(([packingOrderId, po]) => [packingOrderId,
    calculatePackingOrderFoCapacity(
      outputQty(po),
      (allocationsByPo.get(packingOrderId) ?? []).map((row) => ({
        plan_feed_id: text(row.plan_feed_id), allocated_qty_kg: Number(row.allocated_qty_kg),
      })),
      (dispatchesByPo.get(packingOrderId) ?? []).map((row) => ({
        quantity: Number(row.quantity), plan_feed_id: foBySoMapAllocationId.get(text(row.so_map_allocation_id)) || null,
      })),
    ),
  ]));
}
