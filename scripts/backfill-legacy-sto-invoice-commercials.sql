-- One-time operational backfill for the two legacy STO invoices found in
-- production on 2026-09-13:
--   9200000256 (JI/PO36/2026-27)
--   9200000257 (ACP/PO87/2026-27)
--
-- Business decision: EXCLUSIVE 18% GST and FREIGHT_SEPARATE / TO_PAY.
-- GST type is derived from the selling and receiving company states. The
-- script is idempotent for exactly these invoices and does not touch any
-- other STO, DO, or stock-posting row. Legacy STO GST snapshots are left
-- unchanged because an active-DO guard correctly prevents source edits;
-- the invoice and CSN are the authoritative backfill targets.
--
-- Prerequisite: apply 20260912172116_sto_invoice_commercial_resolution.sql
-- to the target database first. This is operational data correction, not a
-- schema migration: run through the Supabase MCP after review.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
DECLARE
  target_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'erp_procurement'
      AND table_name = 'sales_invoice_line'
      AND column_name = 'gst_treatment'
  ) THEN
    RAISE EXCEPTION 'Apply migration 20260912172116_sto_invoice_commercial_resolution before this backfill.';
  END IF;

  SELECT count(*) INTO target_count
  FROM erp_procurement.sales_invoice
  WHERE invoice_number IN ('9200000256', '9200000257');
  IF target_count <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two target invoices, found %.', target_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM erp_procurement.sales_invoice si
    JOIN erp_procurement.stock_transfer_order sto ON sto.id = si.sto_id
    JOIN erp_procurement.sales_invoice_line sil ON sil.invoice_id = si.id
    JOIN erp_procurement.delivery_challan_line dcl ON dcl.id = sil.dc_line_id
    JOIN erp_procurement.stock_transfer_order_line sl ON sl.id = dcl.sto_line_id
    LEFT JOIN erp_master.companies sender ON sender.id = si.company_id
    LEFT JOIN erp_master.companies receiver ON receiver.id = sto.receiving_company_id
    WHERE si.invoice_number IN ('9200000256', '9200000257')
      AND (
        si.status <> 'POSTED'
        OR dcl.sto_line_id IS NULL
        OR sl.gst_terms <> 'EXCLUSIVE'
        OR COALESCE(sl.gst_rate, 0) NOT IN (0, 18)
        OR COALESCE(sil.gst_rate, 0) NOT IN (0, 18)
        OR (sil.gst_treatment IS NOT NULL AND sil.gst_treatment <> 'EXCLUSIVE')
        OR sl.freight_term <> 'FREIGHT_SEPARATE'
        OR NULLIF(BTRIM(sender.state_name), '') IS NULL
        OR NULLIF(BTRIM(receiver.state_name), '') IS NULL
        OR si.freight_included <> false
        OR si.freight_amount IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Target invoice shape changed or is unsafe for the approved legacy STO backfill.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM erp_procurement.sales_invoice_additional_cost_line acl
    JOIN erp_procurement.sales_invoice si ON si.id = acl.invoice_id
    WHERE si.invoice_number IN ('9200000256', '9200000257')
  ) THEN
    RAISE EXCEPTION 'Target invoices contain additional costs; do not recalculate their totals with this script.';
  END IF;
END;
$guard$;

WITH target_lines AS (
  SELECT
    si.id AS invoice_id,
    sil.id AS invoice_line_id,
    sl.id AS sto_line_id,
    lower(BTRIM(sender.state_name)) = lower(BTRIM(receiver.state_name)) AS intra_state,
    round(sil.quantity * sil.rate, 4) AS taxable_value,
    round(sil.quantity * sil.rate * 0.18, 4) AS gst_amount
  FROM erp_procurement.sales_invoice si
  JOIN erp_procurement.stock_transfer_order sto ON sto.id = si.sto_id
  JOIN erp_master.companies sender ON sender.id = si.company_id
  JOIN erp_master.companies receiver ON receiver.id = sto.receiving_company_id
  JOIN erp_procurement.sales_invoice_line sil ON sil.invoice_id = si.id
  JOIN erp_procurement.delivery_challan_line dcl ON dcl.id = sil.dc_line_id
  JOIN erp_procurement.stock_transfer_order_line sl ON sl.id = dcl.sto_line_id
  WHERE si.invoice_number IN ('9200000256', '9200000257')
), updated_lines AS (
  UPDATE erp_procurement.sales_invoice_line sil
  SET gst_treatment = 'EXCLUSIVE',
      gst_rate = 18,
      cgst_rate = CASE WHEN target.intra_state THEN 9 ELSE 0 END,
      sgst_rate = CASE WHEN target.intra_state THEN 9 ELSE 0 END,
      igst_rate = CASE WHEN target.intra_state THEN 0 ELSE 18 END,
      taxable_value = target.taxable_value,
      cgst_amount = CASE WHEN target.intra_state THEN round(target.gst_amount / 2, 4) ELSE 0 END,
      sgst_amount = CASE WHEN target.intra_state THEN target.gst_amount - round(target.gst_amount / 2, 4) ELSE 0 END,
      igst_amount = CASE WHEN target.intra_state THEN 0 ELSE target.gst_amount END,
      line_total = target.taxable_value + target.gst_amount,
      freight_taxable_allocation = 0
  FROM target_lines target
  WHERE sil.id = target.invoice_line_id
  RETURNING sil.invoice_id, sil.line_total
), invoice_totals AS (
  SELECT invoice_id, round(sum(line_total), 4) AS line_total
  FROM updated_lines
  GROUP BY invoice_id
)
UPDATE erp_procurement.sales_invoice si
SET freight_to_pay = true,
    freight_included = false,
    freight_amount = NULL,
    source_freight_term = 'FREIGHT_SEPARATE',
    freight_tax_method = NULL,
    freight_amount_basis = 'TO_PAY',
    freight_taxable_value = 0,
    freight_cgst_amount = 0,
    freight_sgst_amount = 0,
    freight_igst_amount = 0,
    total_invoice_value = totals.line_total + si.round_off_amount
FROM invoice_totals totals
WHERE si.id = totals.invoice_id;

UPDATE erp_procurement.consignment_note csn
SET transporter_id = dc.transporter_id,
    transporter_name_freetext = dc.transporter_name_freetext,
    domestic_transporter_id = dc.transporter_id,
    domestic_transporter_freetext = dc.transporter_name_freetext,
    lr_number = dc.lr_number,
    lr_date = dc.lr_date,
    vehicle_number = dc.vehicle_number,
    invoice_number = COALESCE(NULLIF(si.tally_invoice_number, ''), si.invoice_number),
    invoice_date = COALESCE(si.tally_invoice_date, si.invoice_date),
    last_updated_at = now()
FROM erp_procurement.sales_invoice si
JOIN erp_procurement.delivery_challan dc ON dc.id = si.dc_id
JOIN erp_procurement.sales_invoice_line sil ON sil.invoice_id = si.id
JOIN erp_procurement.delivery_challan_line dcl ON dcl.id = sil.dc_line_id
WHERE si.invoice_number IN ('9200000256', '9200000257')
  AND csn.sto_line_id = dcl.sto_line_id
  AND csn.status NOT IN ('CAN', 'KOF');

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM erp_procurement.sales_invoice si
    JOIN erp_procurement.sales_invoice_line sil ON sil.invoice_id = si.id
    WHERE si.invoice_number IN ('9200000256', '9200000257')
      AND (
        sil.gst_treatment <> 'EXCLUSIVE'
        OR COALESCE(sil.gst_rate, -1) <> 18
        OR COALESCE(sil.igst_rate, -1) <> 18
        OR COALESCE(sil.cgst_rate, 0) <> 0
        OR COALESCE(sil.sgst_rate, 0) <> 0
        OR sil.line_total <> sil.taxable_value + COALESCE(sil.igst_amount, 0)
        OR si.freight_to_pay <> true
        OR si.freight_included <> false
        OR si.freight_amount IS NOT NULL
        OR si.freight_amount_basis <> 'TO_PAY'
        OR si.total_invoice_value <> (
          SELECT round(sum(check_line.line_total), 4) + si.round_off_amount
          FROM erp_procurement.sales_invoice_line check_line
          WHERE check_line.invoice_id = si.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Legacy STO commercial backfill verification failed; transaction rolled back.';
  END IF;
END;
$verify$;

COMMIT;
