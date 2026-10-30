-- STO / FG STO: SO02 PGI + Invoice -> CSN Tally invoice number/date, so the CSN (and the receiver's
-- Gate Entry drawer, which reads it from the CSN) is filled without anyone typing it.
--
-- A trigger (not another edit of the PGI function chain, which is wrapped three times) so it also
-- covers later edits of the Tally fields and the reversal path. Keyed like the DO sync: the invoice's
-- DO lines -> STO line -> CSN by (sto_id, material_id), only while the CSN is ORD/TRN/GED.
CREATE OR REPLACE FUNCTION erp_procurement.sync_sto_invoice_to_csn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'erp_procurement', 'pg_catalog'
AS $$
BEGIN
  IF NEW.sto_id IS NULL OR NEW.dc_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'POSTED' AND NEW.tally_invoice_number IS NOT NULL THEN
    UPDATE erp_procurement.consignment_note c
       SET invoice_number = NEW.tally_invoice_number,
           invoice_date = NEW.tally_invoice_date,
           last_updated_at = now()
      FROM (
        SELECT DISTINCT sol.sto_id, dcl.material_id
          FROM erp_procurement.delivery_challan_line dcl
          JOIN erp_procurement.stock_transfer_order_line sol ON sol.id = dcl.sto_line_id
         WHERE dcl.dc_id = NEW.dc_id
      ) x
     WHERE c.sto_id = x.sto_id AND c.material_id = x.material_id
       AND c.status IN ('ORD', 'TRN', 'GED');
  ELSIF NEW.status = 'CANCELLED' THEN
    -- Reversal: clear only what this invoice wrote.
    UPDATE erp_procurement.consignment_note c
       SET invoice_number = NULL, invoice_date = NULL, last_updated_at = now()
      FROM (
        SELECT DISTINCT sol.sto_id, dcl.material_id
          FROM erp_procurement.delivery_challan_line dcl
          JOIN erp_procurement.stock_transfer_order_line sol ON sol.id = dcl.sto_line_id
         WHERE dcl.dc_id = NEW.dc_id
      ) x
     WHERE c.sto_id = x.sto_id AND c.material_id = x.material_id
       AND c.status IN ('ORD', 'TRN', 'GED')
       AND c.invoice_number IS NOT DISTINCT FROM coalesce(OLD.tally_invoice_number, NEW.tally_invoice_number);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sto_invoice_to_csn ON erp_procurement.sales_invoice;
CREATE TRIGGER trg_sync_sto_invoice_to_csn
AFTER INSERT OR UPDATE OF status, tally_invoice_number, tally_invoice_date ON erp_procurement.sales_invoice
FOR EACH ROW EXECUTE FUNCTION erp_procurement.sync_sto_invoice_to_csn();
