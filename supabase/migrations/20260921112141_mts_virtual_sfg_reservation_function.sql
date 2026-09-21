CREATE OR REPLACE FUNCTION erp_production.cancel_virtual_mts_sfg_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = erp_production, public
AS $$
BEGIN
  IF NEW.source_type = 'PACKING_PO' AND NEW.source_line_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM erp_production.packing_order_line pol
       JOIN erp_production.packing_order pko ON pko.id = pol.packing_order_id
       JOIN erp_production.process_order po ON po.id = pko.process_order_id
       WHERE pol.id = NEW.source_line_id AND pol.line_type = 'SFG' AND po.po_type = 'MTS'
     )
  THEN
    UPDATE erp_production.reservation_document
    SET status = 'CANCELLED', last_updated_at = now()
    WHERE id = NEW.id AND status IN ('OPEN', 'PARTIAL');
  END IF;
  RETURN NEW;
END;
$$;
