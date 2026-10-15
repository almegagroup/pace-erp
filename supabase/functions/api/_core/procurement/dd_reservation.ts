/*
 * DD (pgi_deferred) Delivery Order reservation rule — business owner,
 * 2026-10-15. A DD DO reserves its lines only while Truck Number AND
 * Dispatch Date are both present; an Invoice-only DD holds no reservation.
 * The rule itself lives in erp_procurement.sync_dd_delivery_order_reservation
 * (migration 20261015041335). Call this after anything that creates a DD DO
 * or changes its Truck / Dispatch Date / lines. It is idempotent and a no-op
 * for non-DD, DISPATCHED or CANCELLED DOs. PGI turns the OPEN rows into
 * FULLY_ISSUED; the DD cancel cascades release them.
 */
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";

export async function syncDdDeliveryOrderReservation(dcId: string, actor: string | null): Promise<{ ok: boolean; message?: string }> {
  const { error } = await serviceRoleClient.schema("erp_procurement").rpc("sync_dd_delivery_order_reservation", {
    p_dc_id: dcId,
    p_actor: actor,
  });
  if (error) {
    console.error("[dd_reservation] sync failed", dcId, JSON.stringify(error));
    return { ok: false, message: error.message };
  }
  return { ok: true };
}
