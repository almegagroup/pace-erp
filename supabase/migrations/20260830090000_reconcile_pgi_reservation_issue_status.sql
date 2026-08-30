-- §133.12 / §133.15 -- PGI can issue a delivery line across more than one
-- invoice group. Keep a reservation's issued quantity derived from posted
-- invoice lines instead of trusting any one group's payload.
--
-- This is intentionally a database-side guard around the existing posting
-- function. It also makes cancellation restore OPEN/PARTIAL accurately when
-- another invoice for the same DO line remains posted.
BEGIN;

CREATE OR REPLACE FUNCTION erp_production.reconcile_pgi_reservation_issue_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, erp_procurement, public
AS $$
DECLARE
  v_issued_qty numeric := 0;
BEGIN
  -- The correction update below invokes this trigger once more. Do not recurse.
  IF pg_trigger_depth() > 1 OR NEW.dc_line_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(sil.quantity), 0)
  INTO v_issued_qty
  FROM erp_procurement.sales_invoice_line sil
  JOIN erp_procurement.sales_invoice si ON si.id = sil.invoice_id
  WHERE sil.dc_line_id = NEW.dc_line_id
    AND si.status = 'POSTED';

  UPDATE erp_production.reservation_document rd
  SET issued_qty = LEAST(v_issued_qty, rd.required_qty),
      status = CASE
        WHEN v_issued_qty >= rd.required_qty - 0.000001 THEN 'FULLY_ISSUED'
        WHEN v_issued_qty > 0 THEN 'PARTIAL'
        ELSE 'OPEN'
      END,
      last_updated_at = now()
  WHERE rd.id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconcile_pgi_reservation_issue_status ON erp_production.reservation_document;
CREATE TRIGGER trg_reconcile_pgi_reservation_issue_status
AFTER UPDATE OF issued_qty, status ON erp_production.reservation_document
FOR EACH ROW EXECUTE FUNCTION erp_production.reconcile_pgi_reservation_issue_status();

GRANT EXECUTE ON FUNCTION erp_production.reconcile_pgi_reservation_issue_status() TO service_role;
COMMIT;
