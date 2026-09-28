-- Fix: guard_sto_line_change() (20260911112900) bundled line_status into the
-- same guarded tuple as quantity/transfer_price/gst_rate/material_id/uom_code
-- -- meant only to freeze an STO line's *commercial identity* once a DO
-- exists against it, mirroring SO/DO's own "Mapped-but-no-DO = editable, DO
-- created = lock" pattern. But line_status is also the field the RECEIVING
-- side (grn.handlers.ts's updateStoLineReceipt(), fixed the same day in
-- 4a2168b) legitimately flips OPEN -> RECEIVED once a GRN completes -- and a
-- DO is *always* active (non-CANCELLED) by the time a real GRN happens,
-- since dispatch (DO+PGI) always precedes receipt. Net effect: every real
-- STO receiving flow was blocked with STO_LINE_HAS_ACTIVE_DO the moment it
-- was actually exercised -- caught 2026-09-27 via a full send+receive
-- verification test against real Prod data (CMP003 -> CMP006), both STO
-- types (INTER_PLANT and CONSIGNMENT_DISTRIBUTION), never previously run
-- end-to-end since no real STO in Prod had reached the receiving step.
--
-- Fix: split the guard. Commercial-identity fields stay frozen once a DO
-- exists (unchanged). The KNOCKED_OFF transition specifically stays guarded
-- too (the trigger's own "no stale knock-off can race an active DO" intent
-- -- knockOffSTOLineHandler's own dispatched_qty=0 check doesn't cover the
-- window where a DO row exists but hasn't been PGI'd yet). The natural
-- OPEN -> RECEIVED transition driven by GRN receipt completion is no longer
-- blocked.
CREATE OR REPLACE FUNCTION erp_procurement.guard_sto_line_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
  PERFORM id FROM erp_procurement.stock_transfer_order WHERE id=NEW.sto_id FOR UPDATE;
  IF (
    (NEW.quantity,NEW.transfer_price,NEW.gst_rate,NEW.material_id,NEW.uom_code)
      IS DISTINCT FROM (OLD.quantity,OLD.transfer_price,OLD.gst_rate,OLD.material_id,OLD.uom_code)
    OR (NEW.line_status = 'KNOCKED_OFF' AND OLD.line_status IS DISTINCT FROM 'KNOCKED_OFF')
  )
    AND EXISTS(SELECT 1 FROM erp_procurement.delivery_challan_line dl JOIN erp_procurement.delivery_challan d ON d.id=dl.dc_id
      WHERE dl.sto_line_id=NEW.id AND d.status<>'CANCELLED') THEN RAISE EXCEPTION 'STO_LINE_HAS_ACTIVE_DO'; END IF;
  RETURN NEW;
END;
$fn$;
