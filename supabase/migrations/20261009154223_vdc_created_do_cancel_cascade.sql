BEGIN;

-- VDC Bulk DOs can be cancelled before Invoice-only posting.  Some of those
-- DOs already carry an OPEN reservation because Truck + Dispatch Date were
-- supplied at Bulk DO upload; others intentionally have none.  Keep this
-- VDC-only branch separate from the established DC/RM/PM/INT cancel path.
CREATE OR REPLACE FUNCTION erp_procurement.cancel_vdc_created_delivery_order_atomic(
  p_dc_id uuid,
  p_reason text,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $function$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'VDC_CANCEL_REASON_REQUIRED';
  END IF;

  PERFORM 1
  FROM erp_procurement.delivery_challan
  WHERE id = p_dc_id
    AND status = 'CREATED'
    AND pgi_deferred = true
    AND is_bulk_uploaded = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VDC_CANCEL_BLOCKED';
  END IF;

  IF EXISTS (SELECT 1 FROM erp_procurement.sales_invoice WHERE dc_id = p_dc_id AND status IN ('DRAFT', 'POSTED')) THEN
    RAISE EXCEPTION 'VDC_CANCEL_INVOICE_ALREADY_EXISTS';
  END IF;

  UPDATE erp_production.reservation_document
  SET status = 'CANCELLED', last_updated_by = p_actor, last_updated_at = v_now
  WHERE dc_line_id IN (SELECT id FROM erp_procurement.delivery_challan_line WHERE dc_id = p_dc_id)
    AND status IN ('OPEN', 'PARTIAL');

  UPDATE erp_production.reservation_document rd
  SET status = 'CANCELLED', last_updated_by = p_actor, last_updated_at = v_now
  FROM erp_procurement.delivery_challan_line dcl
  WHERE dcl.dc_id = p_dc_id
    AND rd.dc_line_id IS NULL
    AND rd.source_line_id = COALESCE(dcl.so_line_id, dcl.sto_line_id)
    AND rd.status IN ('OPEN', 'PARTIAL');

  UPDATE erp_procurement.delivery_challan
  SET status = 'CANCELLED', cancellation_reason = p_reason,
      cancelled_by = p_actor, cancelled_at = v_now
  WHERE id = p_dc_id AND status = 'CREATED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VDC_CANCEL_BLOCKED';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.cancel_vdc_created_delivery_order_atomic(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.cancel_vdc_created_delivery_order_atomic(uuid, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
