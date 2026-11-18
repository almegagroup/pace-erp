-- CMP005 / pack code 209 correction (2026-11-18)
--
-- Business fact: CTN fields were populated with PKT counts.  For pack code
-- 209, 1 CTN = 20 PKT = 20 KG.  Every affected persisted quantity/value is
-- therefore overstated by 20x.  This correction is deliberately narrow:
-- CMP005, MTS FG, pack code 209 only.
--
-- The two affected posted PGIs are corrected append-only: P602 reverses the
-- erroneous P601 and a fresh P601 posts the corrected quantity.  The original
-- stock documents are never mutated, so the stock audit trail stays intact.
--
-- A production rehearsal may run this exact file with the final COMMIT changed
-- to ROLLBACK.  The real execution is a single transaction and archives every
-- before-image in erp_history before it changes a business row.

BEGIN;

CREATE TABLE IF NOT EXISTS erp_history.cmp005_pack209_ctn_as_pkt_correction_20261118 (
  archive_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  row_data jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  correction_note text NOT NULL DEFAULT 'CMP005 pack 209 CTN values were PKT values; divide affected quantity/value by 20',
  UNIQUE (source_table, source_id)
);

-- Keep the target set stable while the assertions, archive, financial
-- correction, and append-only stock correction run.
LOCK TABLE
  erp_procurement.sales_order_line,
  erp_procurement.delivery_challan,
  erp_procurement.delivery_challan_line,
  erp_procurement.sales_order_map_allocation,
  erp_procurement.sales_invoice,
  erp_procurement.sales_invoice_line,
  erp_inventory.stock_document,
  erp_inventory.stock_ledger,
  erp_inventory.stock_snapshot
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE tmp_cmp005_209_so_line ON COMMIT DROP AS
SELECT sol.*
FROM erp_procurement.sales_order_line sol
JOIN erp_procurement.sales_order so ON so.id = sol.so_id
JOIN erp_master.material_master m ON m.id = sol.material_id
WHERE so.company_id = 'a828ea3a-a186-463e-92c2-1ac9767cfe69'::uuid
  AND sol.fg_type = 'MTS'
  AND m.pack_code = '209';

CREATE TEMP TABLE tmp_cmp005_209_dc_line ON COMMIT DROP AS
SELECT dcl.*
FROM erp_procurement.delivery_challan_line dcl
JOIN tmp_cmp005_209_so_line sol ON sol.id = dcl.so_line_id;

CREATE TEMP TABLE tmp_cmp005_209_dc ON COMMIT DROP AS
SELECT dc.*
FROM erp_procurement.delivery_challan dc
JOIN (SELECT DISTINCT dc_id FROM tmp_cmp005_209_dc_line) target ON target.dc_id = dc.id;

CREATE TEMP TABLE tmp_cmp005_209_allocation ON COMMIT DROP AS
SELECT a.*
FROM erp_procurement.sales_order_map_allocation a
JOIN (SELECT DISTINCT so_map_allocation_id AS id FROM tmp_cmp005_209_dc_line) target
  ON target.id = a.id;

CREATE TEMP TABLE tmp_cmp005_209_invoice_line ON COMMIT DROP AS
SELECT sil.*
FROM erp_procurement.sales_invoice_line sil
JOIN tmp_cmp005_209_dc_line dcl ON dcl.id = sil.dc_line_id;

CREATE TEMP TABLE tmp_cmp005_209_invoice ON COMMIT DROP AS
SELECT si.*
FROM erp_procurement.sales_invoice si
JOIN (SELECT DISTINCT invoice_id FROM tmp_cmp005_209_invoice_line) target ON target.invoice_id = si.id;

-- There is one P601 material-document item per affected posted VDC invoice.
-- Limit by the actual targeted invoice line as well as pack code so adjacent
-- non-209 items on the same invoices are untouched.
CREATE TEMP TABLE tmp_cmp005_209_stock_doc ON COMMIT DROP AS
SELECT sd.*
FROM erp_inventory.stock_document sd
JOIN tmp_cmp005_209_invoice_line sil
  ON sil.invoice_id = sd.reference_document_id
 AND sil.material_id = sd.material_id
JOIN erp_master.material_master m ON m.id = sd.material_id
WHERE sd.movement_type_code = 'P601'
  AND sd.reference_document_type = 'VDC_SALES_INVOICE'
  AND sd.reversal_document_id IS NULL
  AND m.pack_code = '209';

CREATE TEMP TABLE tmp_cmp005_209_stock_ledger ON COMMIT DROP AS
SELECT sl.*
FROM erp_inventory.stock_ledger sl
JOIN tmp_cmp005_209_stock_doc sd ON sd.id = sl.stock_document_id;

CREATE TEMP TABLE tmp_cmp005_209_snapshot ON COMMIT DROP AS
SELECT ss.*
FROM erp_inventory.stock_snapshot ss
JOIN (
  SELECT DISTINCT company_id, source_location_id AS storage_location_id, material_id,
         source_stock_type AS stock_type_code
  FROM tmp_cmp005_209_stock_doc
) target
  ON target.company_id = ss.company_id
 AND target.storage_location_id = ss.storage_location_id
 AND target.material_id = ss.material_id
 AND target.stock_type_code = ss.stock_type_code
 AND ss.batch_id IS NULL;

CREATE TEMP TABLE tmp_cmp005_209_stock_post_result (
  original_stock_document_id uuid PRIMARY KEY,
  reversal_stock_document_id uuid NOT NULL,
  reversal_stock_ledger_id uuid NOT NULL,
  corrected_stock_document_id uuid NOT NULL,
  corrected_stock_ledger_id uuid NOT NULL
) ON COMMIT DROP;

DO $correction$
DECLARE
  v_expected_count integer;
  v_archive_count integer;
  v_snapshot_qty numeric;
  v_ledger_qty numeric;
  v_expected_snapshot_qty numeric;
  v_doc record;
  v_material_doc record;
  v_reversal_doc_id uuid;
  v_reversal_ledger_id uuid;
  v_corrected_doc_id uuid;
  v_corrected_ledger_id uuid;
BEGIN
  -- Re-run protection: a correction that has committed is never silently
  -- repeated.  The unique archive keys make this a hard stop as well.
  IF EXISTS (
    SELECT 1
    FROM erp_history.cmp005_pack209_ctn_as_pkt_correction_20261118
  ) THEN
    RAISE EXCEPTION 'CMP005 pack 209 correction was already applied; inspect erp_history archive instead of rerunning';
  END IF;

  SELECT count(*) INTO v_expected_count FROM tmp_cmp005_209_so_line;
  IF v_expected_count <> 40 THEN
    RAISE EXCEPTION 'Expected 40 CMP005 MTS pack-209 SO lines, found %', v_expected_count;
  END IF;

  SELECT count(*) INTO v_expected_count FROM tmp_cmp005_209_dc_line;
  IF v_expected_count <> 29 THEN
    RAISE EXCEPTION 'Expected 29 dependent DO lines, found %', v_expected_count;
  END IF;

  SELECT count(*) INTO v_expected_count FROM tmp_cmp005_209_dc;
  IF v_expected_count <> 13 THEN
    RAISE EXCEPTION 'Expected 13 dependent DO headers, found %', v_expected_count;
  END IF;

  SELECT count(*) INTO v_expected_count FROM tmp_cmp005_209_allocation;
  IF v_expected_count <> 29 THEN
    RAISE EXCEPTION 'Expected 29 linked SO allocations, found %', v_expected_count;
  END IF;

  SELECT count(*) INTO v_expected_count FROM tmp_cmp005_209_invoice_line;
  IF v_expected_count <> 29 THEN
    RAISE EXCEPTION 'Expected 29 dependent invoice lines, found %', v_expected_count;
  END IF;

  SELECT count(*) INTO v_expected_count FROM tmp_cmp005_209_invoice;
  IF v_expected_count <> 13 THEN
    RAISE EXCEPTION 'Expected 13 dependent invoice headers, found %', v_expected_count;
  END IF;

  SELECT count(*) INTO v_expected_count FROM tmp_cmp005_209_stock_doc;
  IF v_expected_count <> 2 THEN
    RAISE EXCEPTION 'Expected two posted pack-209 P601 items, found %', v_expected_count;
  END IF;

  SELECT count(*) INTO v_expected_count FROM tmp_cmp005_209_stock_ledger;
  IF v_expected_count <> 2 THEN
    RAISE EXCEPTION 'Expected two posted pack-209 P601 ledger rows, found %', v_expected_count;
  END IF;

  SELECT count(*) INTO v_expected_count FROM tmp_cmp005_209_snapshot;
  IF v_expected_count <> 1 THEN
    RAISE EXCEPTION 'Expected one CMP005 unrestricted pack-209 snapshot, found %', v_expected_count;
  END IF;

  -- Prove the business fact and exclude any non-linear pricing/costing case.
  IF EXISTS (
    SELECT 1
    FROM tmp_cmp005_209_so_line
    WHERE pack_uom_code <> 'CTN'
       OR per_pack_qty <> 20
       OR rate_basis <> 'PACK_UOM'
       OR gst_treatment <> 'EXCLUSIVE'
       OR COALESCE(issued_qty, 0) <> 0
       OR quantity <> base_qty
       OR quantity <> balance_qty
       OR base_qty <> pack_qty * 20
       OR COALESCE(round_off_amount, 0) <> 0
       OR COALESCE(packaging_cost_amount, 0) <> 0
       OR COALESCE(has_rebate, false)
       OR COALESCE(rebate_rate, 0) <> 0
  ) THEN
    RAISE EXCEPTION 'SO target set no longer matches the audited 20x CTN-as-PKT shape';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tmp_cmp005_209_dc_line
    WHERE pack_uom_code <> 'CTN'
       OR display_rate_basis <> 'PACK_UOM'
       OR COALESCE(packaging_cost_amount, 0) <> 0
       OR COALESCE(has_rebate, false)
       OR COALESCE(rebate_rate, 0) <> 0
       OR line_total <> round((quantity * unit_value) + COALESCE(gst_amount, 0), 4)
  ) THEN
    RAISE EXCEPTION 'DO target set no longer matches the audited linear pricing shape';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tmp_cmp005_209_invoice_line
    WHERE pack_uom_code <> 'CTN'
       OR display_rate_basis <> 'PACK_UOM'
       OR COALESCE(freight_taxable_allocation, 0) <> 0
       OR line_total <> round(COALESCE(taxable_value, 0) + COALESCE(cgst_amount, 0)
                              + COALESCE(sgst_amount, 0) + COALESCE(igst_amount, 0), 4)
  ) THEN
    RAISE EXCEPTION 'Invoice target set no longer matches the audited linear tax shape';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tmp_cmp005_209_dc
    WHERE pgi_deferred IS DISTINCT FROM true
       OR status NOT IN ('DISPATCHED', 'INVOICED')
  ) THEN
    RAISE EXCEPTION 'Dependent DO state changed after audit';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tmp_cmp005_209_stock_doc sd
    JOIN tmp_cmp005_209_stock_ledger sl ON sl.stock_document_id = sd.id
    WHERE sd.quantity <> sl.quantity
       OR sd.source_stock_type <> sl.stock_type_code
       OR sl.direction <> 'OUT'
       OR sd.source_stock_type <> 'UNRESTRICTED'
  ) THEN
    RAISE EXCEPTION 'Posted pack-209 P601 rows no longer match their ledger rows';
  END IF;

  SELECT s.quantity,
         COALESCE((
           SELECT SUM(CASE WHEN sl.direction = 'IN' THEN sl.quantity ELSE -sl.quantity END)
           FROM erp_inventory.stock_ledger sl
           WHERE sl.company_id = s.company_id
             AND sl.storage_location_id = s.storage_location_id
             AND sl.material_id = s.material_id
             AND sl.stock_type_code = s.stock_type_code
         ), 0)
    INTO v_snapshot_qty, v_ledger_qty
  FROM tmp_cmp005_209_snapshot s;

  IF v_snapshot_qty <> v_ledger_qty THEN
    RAISE EXCEPTION 'Pre-correction snapshot/ledger mismatch: snapshot %, ledger %', v_snapshot_qty, v_ledger_qty;
  END IF;

  -- Archive all rows that this correction will update or use as an append-only
  -- stock-reversal source.  The before-images make the operation reviewable.
  INSERT INTO erp_history.cmp005_pack209_ctn_as_pkt_correction_20261118 (source_table, source_id, row_data)
  SELECT 'erp_procurement.sales_order_line', id, to_jsonb(t) FROM tmp_cmp005_209_so_line t
  UNION ALL SELECT 'erp_procurement.delivery_challan_line', id, to_jsonb(t) FROM tmp_cmp005_209_dc_line t
  UNION ALL SELECT 'erp_procurement.delivery_challan', id, to_jsonb(t) FROM tmp_cmp005_209_dc t
  UNION ALL SELECT 'erp_procurement.sales_order_map_allocation', id, to_jsonb(t) FROM tmp_cmp005_209_allocation t
  UNION ALL SELECT 'erp_procurement.sales_invoice_line', id, to_jsonb(t) FROM tmp_cmp005_209_invoice_line t
  UNION ALL SELECT 'erp_procurement.sales_invoice', id, to_jsonb(t) FROM tmp_cmp005_209_invoice t
  UNION ALL SELECT 'erp_inventory.stock_document', id, to_jsonb(t) FROM tmp_cmp005_209_stock_doc t
  UNION ALL SELECT 'erp_inventory.stock_ledger', id, to_jsonb(t) FROM tmp_cmp005_209_stock_ledger t
  UNION ALL SELECT 'erp_inventory.stock_snapshot', id, to_jsonb(t) FROM tmp_cmp005_209_snapshot t;

  GET DIAGNOSTICS v_archive_count = ROW_COUNT;
  IF v_archive_count <> 158 THEN
    RAISE EXCEPTION 'Expected 158 archived before-images, archived %', v_archive_count;
  END IF;

  -- Reverse each erroneous P601 exactly once, then post the corrected P601 at
  -- one twentieth of the original physical quantity.  Both corrective entries
  -- use today as posting date; the original business document date/reference
  -- remain on the material documents for traceability.
  FOR v_doc IN
    SELECT sd.*, sl.batch_number, sl.stock_type_code, sl.valuation_rate AS ledger_valuation_rate
    FROM tmp_cmp005_209_stock_doc sd
    JOIN tmp_cmp005_209_stock_ledger sl ON sl.stock_document_id = sd.id
    ORDER BY sd.document_number, sd.item_number
  LOOP
    SELECT * INTO v_material_doc
    FROM erp_inventory.generate_material_doc_number(v_doc.company_id);

    SELECT stock_document_id, stock_ledger_id
      INTO v_reversal_doc_id, v_reversal_ledger_id
    FROM erp_inventory.post_stock_movement(
      v_doc.reference_document_number,
      v_doc.document_date,
      CURRENT_DATE,
      'P602',
      v_doc.company_id,
      v_doc.source_location_id,
      v_doc.material_id,
      v_doc.quantity,
      v_doc.base_uom_code,
      v_doc.ledger_valuation_rate,
      v_doc.stock_type_code,
      'IN',
      v_doc.posted_by,
      v_doc.id,
      v_doc.batch_number,
      v_material_doc.doc_number,
      v_material_doc.doc_year,
      v_doc.reference_document_number,
      v_doc.reference_document_type,
      v_doc.reference_document_id
    );

    SELECT * INTO v_material_doc
    FROM erp_inventory.generate_material_doc_number(v_doc.company_id);

    SELECT stock_document_id, stock_ledger_id
      INTO v_corrected_doc_id, v_corrected_ledger_id
    FROM erp_inventory.post_stock_movement(
      v_doc.reference_document_number,
      v_doc.document_date,
      CURRENT_DATE,
      'P601',
      v_doc.company_id,
      v_doc.source_location_id,
      v_doc.material_id,
      v_doc.quantity / 20,
      v_doc.base_uom_code,
      v_doc.ledger_valuation_rate,
      v_doc.stock_type_code,
      'OUT',
      v_doc.posted_by,
      NULL,
      v_doc.batch_number,
      v_material_doc.doc_number,
      v_material_doc.doc_year,
      v_doc.reference_document_number,
      v_doc.reference_document_type,
      v_doc.reference_document_id
    );

    INSERT INTO tmp_cmp005_209_stock_post_result (
      original_stock_document_id, reversal_stock_document_id, reversal_stock_ledger_id,
      corrected_stock_document_id, corrected_stock_ledger_id
    ) VALUES (
      v_doc.id, v_reversal_doc_id, v_reversal_ledger_id,
      v_corrected_doc_id, v_corrected_ledger_id
    );
  END LOOP;

  SELECT count(*) INTO v_expected_count FROM tmp_cmp005_209_stock_post_result;
  IF v_expected_count <> 2 THEN
    RAISE EXCEPTION 'Expected two P601 reversal/re-post pairs, got %', v_expected_count;
  END IF;

  -- Correct the 20x document quantities and all directly proportional monetary
  -- amounts.  Unit/rate fields remain per CTN, because CTN is the billed pack
  -- UOM; only the count was entered in the wrong UOM.
  UPDATE erp_procurement.sales_order_line sol
  SET pack_qty = t.pack_qty / 20,
      quantity = t.quantity / 20,
      base_qty = t.base_qty / 20,
      balance_qty = t.balance_qty / 20,
      gst_amount = t.gst_amount / 20,
      cgst_amount = t.cgst_amount / 20,
      sgst_amount = t.sgst_amount / 20,
      igst_amount = t.igst_amount / 20,
      total_value = t.total_value / 20,
      last_updated_at = now()
  FROM tmp_cmp005_209_so_line t
  WHERE sol.id = t.id;

  UPDATE erp_procurement.sales_order_map_allocation a
  SET allocated_qty = t.allocated_qty / 20,
      last_updated_at = now()
  FROM tmp_cmp005_209_allocation t
  WHERE a.id = t.id;

  UPDATE erp_procurement.delivery_challan_line dcl
  SET pack_qty = t.pack_qty / 20,
      quantity = t.quantity / 20,
      gst_amount = t.gst_amount / 20,
      line_total = t.line_total / 20
  FROM tmp_cmp005_209_dc_line t
  WHERE dcl.id = t.id;

  UPDATE erp_procurement.sales_invoice_line sil
  SET pack_qty = t.pack_qty / 20,
      quantity = t.quantity / 20,
      taxable_value = t.taxable_value / 20,
      cgst_amount = t.cgst_amount / 20,
      sgst_amount = t.sgst_amount / 20,
      igst_amount = t.igst_amount / 20,
      line_total = t.line_total / 20
  FROM tmp_cmp005_209_invoice_line t
  WHERE sil.id = t.id;

  -- Header totals include every line on each affected document, including any
  -- adjacent non-209 line that was intentionally left untouched.
  UPDATE erp_procurement.delivery_challan dc
  SET net_weight = totals.net_weight
  FROM (
    SELECT dcl.dc_id, SUM(dcl.quantity) AS net_weight
    FROM erp_procurement.delivery_challan_line dcl
    JOIN tmp_cmp005_209_dc target ON target.id = dcl.dc_id
    GROUP BY dcl.dc_id
  ) totals
  WHERE dc.id = totals.dc_id;

  UPDATE erp_procurement.sales_invoice si
  SET total_taxable_value = totals.total_taxable_value,
      total_cgst_amount = totals.total_cgst_amount,
      total_sgst_amount = totals.total_sgst_amount,
      total_igst_amount = totals.total_igst_amount,
      total_gst_amount = totals.total_gst_amount,
      total_invoice_value = round(
        totals.total_line_value + COALESCE(si.additional_cost_total, 0) + COALESCE(si.round_off_amount, 0), 2
      ),
      last_updated_at = now()
  FROM (
    SELECT sil.invoice_id,
           COALESCE(SUM(sil.taxable_value), 0) AS total_taxable_value,
           COALESCE(SUM(sil.cgst_amount), 0) AS total_cgst_amount,
           COALESCE(SUM(sil.sgst_amount), 0) AS total_sgst_amount,
           COALESCE(SUM(sil.igst_amount), 0) AS total_igst_amount,
           COALESCE(SUM(COALESCE(sil.cgst_amount, 0) + COALESCE(sil.sgst_amount, 0) + COALESCE(sil.igst_amount, 0)), 0) AS total_gst_amount,
           COALESCE(SUM(sil.line_total), 0) AS total_line_value
    FROM erp_procurement.sales_invoice_line sil
    JOIN tmp_cmp005_209_invoice target ON target.id = sil.invoice_id
    GROUP BY sil.invoice_id
  ) totals
  WHERE si.id = totals.invoice_id;

  -- Final scope and stock-parity proof.
  IF EXISTS (
    SELECT 1 FROM erp_procurement.sales_order_line sol
    JOIN tmp_cmp005_209_so_line t ON t.id = sol.id
    WHERE sol.pack_qty <> t.pack_qty / 20
       OR sol.quantity <> t.quantity / 20
       OR sol.base_qty <> t.base_qty / 20
       OR sol.balance_qty <> t.balance_qty / 20
       OR sol.total_value <> t.total_value / 20
  ) THEN
    RAISE EXCEPTION 'SO final verification failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM erp_procurement.delivery_challan_line dcl
    JOIN tmp_cmp005_209_dc_line t ON t.id = dcl.id
    WHERE dcl.pack_qty <> t.pack_qty / 20
       OR dcl.quantity <> t.quantity / 20
       OR dcl.line_total <> t.line_total / 20
  ) THEN
    RAISE EXCEPTION 'DO final verification failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM erp_procurement.sales_invoice_line sil
    JOIN tmp_cmp005_209_invoice_line t ON t.id = sil.id
    WHERE sil.pack_qty <> t.pack_qty / 20
       OR sil.quantity <> t.quantity / 20
       OR sil.line_total <> t.line_total / 20
  ) THEN
    RAISE EXCEPTION 'Invoice final verification failed';
  END IF;

  SELECT s.quantity,
         COALESCE((
           SELECT SUM(CASE WHEN sl.direction = 'IN' THEN sl.quantity ELSE -sl.quantity END)
           FROM erp_inventory.stock_ledger sl
           WHERE sl.company_id = s.company_id
             AND sl.storage_location_id = s.storage_location_id
             AND sl.material_id = s.material_id
             AND sl.stock_type_code = s.stock_type_code
         ), 0)
    INTO v_snapshot_qty, v_ledger_qty
  FROM erp_inventory.stock_snapshot s
  JOIN tmp_cmp005_209_snapshot before_image ON before_image.id = s.id;

  SELECT before_image.quantity + SUM(sd.quantity - (sd.quantity / 20))
    INTO v_expected_snapshot_qty
  FROM tmp_cmp005_209_snapshot before_image
  CROSS JOIN tmp_cmp005_209_stock_doc sd
  GROUP BY before_image.quantity;

  IF v_snapshot_qty <> v_expected_snapshot_qty OR v_snapshot_qty <> v_ledger_qty THEN
    RAISE EXCEPTION 'Post-correction snapshot/ledger mismatch: expected %, snapshot %, ledger %',
      v_expected_snapshot_qty, v_snapshot_qty, v_ledger_qty;
  END IF;
END;
$correction$;

COMMIT;
