-- DD (pgi_deferred) Delivery Order reservation rule — business owner,
-- 2026-10-15. Supersedes the 2026-10-09 "DD creation never reserves" note in
-- 20261009151000_vdc_deferred_pgi_reservation_contract.sql:
--
--   * Truck Number AND Dispatch Date both present  -> the DO's lines are
--     reserved (OPEN) from that moment: at DO create, or as soon as the
--     missing field is filled later (Edit Transporter, SO02 correction,
--     Truck & Dispatch upload).
--   * either one missing (Invoice-only DD)          -> no reservation.
--   * PGI (complete_vdc_pgi_only_action) already turns existing OPEN rows
--     into FULLY_ISSUED, and every DD cancel cascade already cancels OPEN
--     rows -- both unchanged.
--
-- The reservation does not hard-block on stock: the truck has physically
-- left, and PGI still runs the real stock check.
--
-- Idempotent: a line that already has an OPEN / PARTIAL / FULLY_ISSUED
-- reservation is never reserved twice. Only CREATED / INVOICED DD DOs are
-- touched; DISPATCHED and CANCELLED DOs are left alone.

CREATE OR REPLACE FUNCTION erp_procurement.sync_dd_delivery_order_reservation(
  p_dc_id uuid,
  p_actor uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $function$
DECLARE
  v_dc erp_procurement.delivery_challan%ROWTYPE;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_dc
  FROM erp_procurement.delivery_challan
  WHERE id = p_dc_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_dc.pgi_deferred IS DISTINCT FROM true
    OR v_dc.status NOT IN ('CREATED', 'INVOICED') THEN
    RETURN 0;
  END IF;

  IF NULLIF(btrim(COALESCE(v_dc.vehicle_number, '')), '') IS NULL OR v_dc.dispatch_date IS NULL THEN
    -- Invoice-only DD: must hold no open reservation (e.g. one left by a
    -- DO edit, which re-creates reservations for every line).
    UPDATE erp_production.reservation_document
    SET status = 'CANCELLED', last_updated_by = p_actor, last_updated_at = now()
    WHERE dc_line_id IN (SELECT id FROM erp_procurement.delivery_challan_line WHERE dc_id = p_dc_id)
      AND status IN ('OPEN', 'PARTIAL')
      AND COALESCE(issued_qty, 0) = 0;
    RETURN 0;
  END IF;

  INSERT INTO erp_production.reservation_document (
    dc_line_id, source_type, source_id, source_line_id, company_id, material_id,
    storage_location_id, batch_number, packing_order_id, required_qty, uom_code,
    issued_qty, status, created_by, created_at, last_updated_by, last_updated_at
  )
  SELECT dcl.id, 'SALES_ORDER', sol.so_id, dcl.so_line_id, v_dc.selling_company_id,
    dcl.material_id, dcl.storage_location_id, dcl.batch_number, dcl.packing_order_id,
    dcl.quantity, COALESCE(NULLIF(dcl.uom_code, ''), 'KG'),
    0, 'OPEN', p_actor, now(), p_actor, now()
  FROM erp_procurement.delivery_challan_line dcl
  JOIN erp_procurement.sales_order_line sol ON sol.id = dcl.so_line_id
  WHERE dcl.dc_id = p_dc_id
    AND COALESCE(dcl.quantity, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM erp_production.reservation_document rd
      WHERE rd.dc_line_id = dcl.id
        AND rd.status IN ('OPEN', 'PARTIAL', 'FULLY_ISSUED')
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.sync_dd_delivery_order_reservation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.sync_dd_delivery_order_reservation(uuid, uuid) TO service_role;

-- Backfill: every existing CREATED / INVOICED DD DO is brought to the rule
-- (reserve where Truck + Dispatch Date are both present).
DO $backfill$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM erp_procurement.delivery_challan
    WHERE pgi_deferred = true AND status IN ('CREATED', 'INVOICED')
  LOOP
    PERFORM erp_procurement.sync_dd_delivery_order_reservation(v_id, NULL);
  END LOOP;
END
$backfill$;

NOTIFY pgrst, 'reload schema';
