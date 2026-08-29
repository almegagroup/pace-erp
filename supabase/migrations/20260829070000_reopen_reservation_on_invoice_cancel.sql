-- PGI reversal returns stock and reopens the DO, so its own reservation must
-- again hold the restored stock. Keep another posted invoice on the same DO
-- line authoritative in the rare grouped-invoice case.
BEGIN;

CREATE OR REPLACE FUNCTION erp_procurement.reopen_reservation_after_invoice_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'CANCELLED' AND NEW.status = 'CANCELLED' THEN
    UPDATE erp_production.reservation_document reservation
    SET status = 'OPEN',
        issued_qty = 0,
        last_updated_at = now(),
        last_updated_by = NEW.cancelled_by
    WHERE reservation.dc_line_id IN (
      SELECT invoice_line.dc_line_id
      FROM erp_procurement.sales_invoice_line invoice_line
      WHERE invoice_line.invoice_id = NEW.id
        AND invoice_line.dc_line_id IS NOT NULL
    )
      AND reservation.status = 'FULLY_ISSUED'
      AND NOT EXISTS (
        SELECT 1
        FROM erp_procurement.sales_invoice_line other_line
        JOIN erp_procurement.sales_invoice other_invoice ON other_invoice.id = other_line.invoice_id
        WHERE other_line.dc_line_id = reservation.dc_line_id
          AND other_invoice.status = 'POSTED'
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reopen_reservation_after_invoice_cancel ON erp_procurement.sales_invoice;
CREATE TRIGGER trg_reopen_reservation_after_invoice_cancel
AFTER UPDATE OF status ON erp_procurement.sales_invoice
FOR EACH ROW EXECUTE FUNCTION erp_procurement.reopen_reservation_after_invoice_cancel();

GRANT EXECUTE ON FUNCTION erp_procurement.reopen_reservation_after_invoice_cancel() TO service_role;
COMMIT;
