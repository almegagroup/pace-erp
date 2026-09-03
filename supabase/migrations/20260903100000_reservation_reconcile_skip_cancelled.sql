-- Found live 2026-09-03 (business owner, CMP006 DO 9100000048): cancelling a
-- DO correctly set its reservation_document row to CANCELLED, but this
-- trigger -- which fires on ANY update to status or issued_qty, to keep a
-- reservation's OPEN/PARTIAL/FULLY_ISSUED state in sync with real posted
-- invoice quantity -- had no concept of CANCELLED as a terminal state. It
-- recomputed v_issued_qty=0 for the (now-cancelled, never invoiced) row and
-- unconditionally forced status back to 'OPEN' in the very same statement,
-- silently reverting the cancellation and leaving the material's Available
-- permanently understated. Confirmed live: a direct manual UPDATE to
-- CANCELLED reverted to OPEN within the same request. Skips reconciliation
-- entirely once a row is (or is being set to) CANCELLED -- that lifecycle
-- transition belongs solely to DO cancel, never to invoice-driven
-- reconciliation.
CREATE OR REPLACE FUNCTION erp_production.reconcile_pgi_reservation_issue_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'erp_production', 'erp_procurement', 'public'
AS $function$
DECLARE
  v_issued_qty numeric := 0;
BEGIN
  -- The correction update below invokes this trigger once more. Do not recurse.
  -- CANCELLED is a terminal state owned by DO cancel -- never resurrect it.
  IF pg_trigger_depth() > 1 OR NEW.dc_line_id IS NULL OR NEW.status = 'CANCELLED' THEN
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
  WHERE rd.id = NEW.id
    AND rd.status <> 'CANCELLED';

  RETURN NEW;
END;
$function$;
