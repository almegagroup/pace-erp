-- CMP006 historical correction: MTEST sample invoice 9200000206 was entered as
-- 1 KG / 0.2 BBL even though the selected SKU is a 5 KG sample (one BBL).
-- The resulting 4 KG apparent balance was later cleared by PID 6500000024.
-- Correct the complete source-to-ledger chain in one transaction: P601 becomes
-- the true 5 KG issue and the erroneous compensating P702 document/ledger is
-- removed.  Therefore the batch, stock snapshot and ledger remain reconciled
-- at zero closing quantity.

DO $$
DECLARE
  v_company_id uuid;
  v_invoice_id uuid;
  v_dc_id uuid;
  v_so_line_id uuid;
  v_p601_document_id uuid;
  v_p601_ledger_id uuid;
  v_p702_document_id uuid;
  v_p702_ledger_id uuid;
  v_pi_item_id uuid;
BEGIN
  SELECT id, company_id, dc_id
    INTO v_invoice_id, v_company_id, v_dc_id
  FROM erp_procurement.sales_invoice
  WHERE invoice_number = '9200000206'
    AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006');

  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'CMP006 sample invoice 9200000206 was not found';
  END IF;

  SELECT so_line_id INTO v_so_line_id
  FROM erp_procurement.sales_invoice_line
  WHERE invoice_id = v_invoice_id
    AND quantity = 1
    AND uom_code = 'KG'
    AND pack_qty = 0.2;

  IF v_so_line_id IS NULL THEN
    RAISE EXCEPTION 'Unexpected invoice-line state for CMP006 sample invoice 9200000206';
  END IF;

  SELECT id INTO v_p601_document_id
  FROM erp_inventory.stock_document
  WHERE reference_document_type = 'SALES_INVOICE'
    AND reference_document_id = v_invoice_id
    AND movement_type_code = 'P601'
    AND quantity = 1;

  SELECT id INTO v_p601_ledger_id
  FROM erp_inventory.stock_ledger
  WHERE stock_document_id = v_p601_document_id
    AND movement_type_code = 'P601'
    AND quantity = 1
    AND batch_number = 'BMAM0926/00004';

  SELECT id INTO v_p702_document_id
  FROM erp_inventory.stock_document
  WHERE reference_document_type = 'PI'
    AND reference_document_number = '6500000024'
    AND company_id = v_company_id
    AND material_id = (SELECT material_id FROM erp_procurement.sales_invoice_line WHERE invoice_id = v_invoice_id)
    AND movement_type_code = 'P702'
    AND quantity = 4;

  SELECT id INTO v_p702_ledger_id
  FROM erp_inventory.stock_ledger
  WHERE stock_document_id = v_p702_document_id
    AND movement_type_code = 'P702'
    AND quantity = 4
    AND batch_number = 'BMAM0926/00004';

  SELECT id INTO v_pi_item_id
  FROM erp_procurement.physical_inventory_item
  WHERE posted_stock_document_id = v_p702_document_id
    AND material_id = (SELECT material_id FROM erp_procurement.sales_invoice_line WHERE invoice_id = v_invoice_id)
    AND batch_number = 'BMAM0926/00004'
    AND book_qty = 4
    AND physical_qty = 0
    AND difference_qty = -4;

  IF v_p601_document_id IS NULL OR v_p601_ledger_id IS NULL
    OR v_p702_document_id IS NULL OR v_p702_ledger_id IS NULL OR v_pi_item_id IS NULL THEN
    RAISE EXCEPTION 'CMP006 sample backfill precondition failed: stock/document chain is not the expected 1 KG P601 plus 4 KG P702 state';
  END IF;

  IF (SELECT count(*) FROM erp_production.dispatch_reco WHERE invoice_number = '9200000206' AND is_voided = false) <> 15 THEN
    RAISE EXCEPTION 'CMP006 sample backfill precondition failed: unexpected dispatch reconciliation row count';
  END IF;
END $$;

-- This is the sole approved historical correction.  Keep the stock-ledger
-- append-only guards down only for the identified P601 update and erroneous
-- P702 removal, then reinstate both before this migration completes.  Any
-- failure rolls back the whole transaction.
DROP RULE stock_ledger_no_update ON erp_inventory.stock_ledger;
DROP RULE stock_ledger_no_delete ON erp_inventory.stock_ledger;

UPDATE erp_procurement.sales_order_line sol
SET quantity = 5,
    base_qty = 5,
    balance_qty = 5,
    pack_qty = 1
FROM erp_procurement.sales_invoice_line sil
WHERE sil.invoice_id = (SELECT id FROM erp_procurement.sales_invoice WHERE invoice_number = '9200000206' AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006'))
  AND sol.id = sil.so_line_id;

UPDATE erp_procurement.delivery_challan_line dcl
SET quantity = 5,
    pack_qty = 1,
    display_uom_code = 'BBL'
FROM erp_procurement.sales_invoice si
WHERE si.invoice_number = '9200000206'
  AND si.company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')
  AND dcl.dc_id = si.dc_id
  AND dcl.quantity = 1
  AND dcl.batch_number = 'BMAM0926/00004';

UPDATE erp_procurement.sales_invoice_line
SET quantity = 5,
    pack_qty = 1,
    display_uom_code = 'BBL'
WHERE invoice_id = (SELECT id FROM erp_procurement.sales_invoice WHERE invoice_number = '9200000206' AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006'))
  AND quantity = 1
  AND pack_qty = 0.2;

UPDATE erp_production.dispatch_reco
SET dispatch_qty_kg = 5,
    standard_qty = round(standard_qty * 5, 6),
    actual_qty = round(actual_qty * 5, 6),
    ap_approved_qty = round(ap_approved_qty * 5, 6)
WHERE invoice_number = '9200000206'
  AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')
  AND is_voided = false;

UPDATE erp_inventory.stock_document
SET quantity = 5,
    value = round(valuation_rate * 5, 4)
WHERE reference_document_type = 'SALES_INVOICE'
  AND reference_document_number = '9200000206'
  AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')
  AND movement_type_code = 'P601'
  AND quantity = 1;

UPDATE erp_inventory.stock_ledger
SET quantity = 5,
    value = round(valuation_rate * 5, 4),
    posted_quantity = -5,
    posted_value = -round(valuation_rate * 5, 4)
WHERE movement_type_code = 'P601'
  AND quantity = 1
  AND batch_number = 'BMAM0926/00004'
  AND stock_document_id = (
    SELECT id FROM erp_inventory.stock_document
    WHERE reference_document_type = 'SALES_INVOICE'
      AND reference_document_number = '9200000206'
      AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')
      AND movement_type_code = 'P601'
  );

UPDATE erp_procurement.physical_inventory_item
SET book_qty = 0,
    posted_stock_document_id = NULL
WHERE posted_stock_document_id = (
  SELECT id FROM erp_inventory.stock_document
  WHERE reference_document_type = 'PI'
    AND reference_document_number = '6500000024'
    AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')
    AND material_id = (SELECT material_id FROM erp_procurement.sales_invoice_line WHERE invoice_id = (SELECT id FROM erp_procurement.sales_invoice WHERE invoice_number = '9200000206' AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')))
    AND movement_type_code = 'P702'
    AND quantity = 4
)
  AND batch_number = 'BMAM0926/00004';

DELETE FROM erp_inventory.stock_ledger
WHERE movement_type_code = 'P702'
  AND quantity = 4
  AND batch_number = 'BMAM0926/00004'
  AND stock_document_id = (
    SELECT id FROM erp_inventory.stock_document
    WHERE reference_document_type = 'PI'
      AND reference_document_number = '6500000024'
      AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')
      AND material_id = (SELECT material_id FROM erp_procurement.sales_invoice_line WHERE invoice_id = (SELECT id FROM erp_procurement.sales_invoice WHERE invoice_number = '9200000206' AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')))
      AND movement_type_code = 'P702'
      AND quantity = 4
  );

DELETE FROM erp_inventory.stock_document
WHERE reference_document_type = 'PI'
  AND reference_document_number = '6500000024'
  AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')
  AND material_id = (SELECT material_id FROM erp_procurement.sales_invoice_line WHERE invoice_id = (SELECT id FROM erp_procurement.sales_invoice WHERE invoice_number = '9200000206' AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')))
  AND movement_type_code = 'P702'
  AND quantity = 4;

CREATE RULE stock_ledger_no_update AS
  ON UPDATE TO erp_inventory.stock_ledger DO INSTEAD NOTHING;

CREATE RULE stock_ledger_no_delete AS
  ON DELETE TO erp_inventory.stock_ledger DO INSTEAD NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_rules
    WHERE schemaname = 'erp_inventory' AND tablename = 'stock_ledger' AND rulename = 'stock_ledger_no_update'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_rules
    WHERE schemaname = 'erp_inventory' AND tablename = 'stock_ledger' AND rulename = 'stock_ledger_no_delete'
  ) THEN
    RAISE EXCEPTION 'stock_ledger append-only guards were not restored';
  END IF;

  IF (SELECT count(*) FROM erp_inventory.stock_ledger
      WHERE batch_number = 'BMAM0926/00004'
        AND material_id = (SELECT material_id FROM erp_procurement.sales_invoice_line WHERE invoice_id = (SELECT id FROM erp_procurement.sales_invoice WHERE invoice_number = '9200000206' AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')))
        AND movement_type_code IN ('P101', 'P601')
        AND posted_quantity <> 0) <> 2 THEN
    RAISE EXCEPTION 'CMP006 sample backfill postcondition failed: unexpected non-zero batch movement count';
  END IF;

  IF (SELECT coalesce(sum(posted_quantity), 0) FROM erp_inventory.stock_ledger
      WHERE batch_number = 'BMAM0926/00004'
        AND material_id = (SELECT material_id FROM erp_procurement.sales_invoice_line WHERE invoice_id = (SELECT id FROM erp_procurement.sales_invoice WHERE invoice_number = '9200000206' AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')))
        AND movement_type_code IN ('P101', 'P601')) <> 0 THEN
    RAISE EXCEPTION 'CMP006 sample backfill postcondition failed: batch closing quantity is not zero';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM erp_inventory.stock_ledger l
    JOIN erp_inventory.stock_document d ON d.id = l.stock_document_id
    WHERE d.reference_document_type = 'SALES_INVOICE'
      AND d.reference_document_number = '9200000206'
      AND d.company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')
      AND l.movement_type_code = 'P601'
      AND l.quantity = 5 AND l.posted_quantity = -5
  ) OR EXISTS (
    SELECT 1 FROM erp_inventory.stock_document
    WHERE reference_document_type = 'PI'
      AND reference_document_number = '6500000024'
      AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')
      AND material_id = (SELECT material_id FROM erp_procurement.sales_invoice_line WHERE invoice_id = (SELECT id FROM erp_procurement.sales_invoice WHERE invoice_number = '9200000206' AND company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')))
      AND movement_type_code = 'P702'
      AND quantity = 4
  ) THEN
    RAISE EXCEPTION 'CMP006 sample backfill postcondition failed: corrected P601 or removed P702 state was not persisted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM erp_procurement.physical_inventory_item pii
    JOIN erp_procurement.physical_inventory_document pid ON pid.id = pii.document_id
    WHERE pid.document_number = '6500000024'
      AND pii.batch_number = 'BMAM0926/00004'
      AND book_qty = 0 AND physical_qty = 0 AND difference_qty = 0
      AND posted_stock_document_id IS NULL
  ) THEN
    RAISE EXCEPTION 'CMP006 sample backfill postcondition failed: PID item was not reconciled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM erp_inventory.stock_snapshot ss
    JOIN erp_inventory.stock_ledger p601 ON p601.storage_location_id = ss.storage_location_id
      AND p601.material_id = ss.material_id AND p601.stock_type_code = ss.stock_type_code
    JOIN erp_inventory.stock_document d ON d.id = p601.stock_document_id
    WHERE d.reference_document_type = 'SALES_INVOICE'
      AND d.reference_document_number = '9200000206'
      AND d.company_id = (SELECT id FROM erp_master.companies WHERE company_code = 'CMP006')
      AND p601.movement_type_code = 'P601'
      AND ss.quantity <> 0
  ) THEN
    RAISE EXCEPTION 'CMP006 sample backfill postcondition failed: current stock snapshot unexpectedly changed';
  END IF;
END $$;
