-- Found live 2026-09-03 (business owner, CMP006 DO 9100000048): cancelling a
-- DO left its reservation_document row stuck OPEN, blocking the same
-- material/location from showing correct Available on the next DO. The
-- release query logic itself reads correctly (dc_line_id match, OPEN/PARTIAL
-- status filter) -- the real defect is that cancelDeliveryOrderHandler did
-- this as two separate, non-transactional Supabase calls (delivery_challan
-- status update, then reservation_document release): a genuine multi-step-
-- write gap of exactly the shape CLAUDE.md's §8D already tracks for other
-- posting handlers, just never closed for DO cancel. If the reservation
-- release step fails for ANY reason after the status commit succeeds (a
-- transient error, a deploy restart mid-request), the DO is left CANCELLED
-- with its reservation permanently dangling OPEN -- exactly this symptom.
-- Folds the two into one transaction so a failure rolls back both, and adds
-- a race-safe status re-check (WHERE status = 'CREATED') the old two-call
-- version never had either.
CREATE OR REPLACE FUNCTION erp_procurement.cancel_delivery_order_atomic(
  p_dc_id uuid,
  p_reason text,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $fn$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE erp_procurement.delivery_challan
  SET status = 'CANCELLED', cancellation_reason = p_reason, cancelled_by = p_actor, cancelled_at = v_now
  WHERE id = p_dc_id AND status = 'CREATED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DO_CANCEL_BLOCKED';
  END IF;

  -- §133.12 -- release by dc_line_id (THIS DC's own lines) first; a
  -- multi-source DO's sibling DOs against the same source line keep their
  -- own separate OPEN reservations untouched.
  UPDATE erp_production.reservation_document
  SET status = 'CANCELLED', last_updated_by = p_actor, last_updated_at = v_now
  WHERE dc_line_id IN (SELECT id FROM erp_procurement.delivery_challan_line WHERE dc_id = p_dc_id)
    AND status IN ('OPEN', 'PARTIAL');

  -- Legacy fallback for pre-§133.12 rows with no dc_line_id of their own.
  UPDATE erp_production.reservation_document rd
  SET status = 'CANCELLED', last_updated_by = p_actor, last_updated_at = v_now
  FROM erp_procurement.delivery_challan_line dcl
  WHERE dcl.dc_id = p_dc_id
    AND rd.dc_line_id IS NULL
    AND rd.source_line_id = COALESCE(dcl.so_line_id, dcl.sto_line_id)
    AND rd.status IN ('OPEN', 'PARTIAL');
END;
$fn$;

REVOKE ALL ON FUNCTION erp_procurement.cancel_delivery_order_atomic(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.cancel_delivery_order_atomic(uuid, text, uuid) TO service_role;
