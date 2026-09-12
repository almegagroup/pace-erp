-- STO commercial authority lives in SO02.  These fields preserve the exact
-- tax/freight decision used by an invoice without changing old STO/DO GST
-- compatibility columns or operational data.
BEGIN;

ALTER TABLE erp_procurement.sales_invoice
  ADD COLUMN IF NOT EXISTS source_freight_term text,
  ADD COLUMN IF NOT EXISTS freight_tax_method text,
  ADD COLUMN IF NOT EXISTS freight_amount_basis text,
  ADD COLUMN IF NOT EXISTS freight_taxable_value numeric,
  ADD COLUMN IF NOT EXISTS freight_cgst_amount numeric,
  ADD COLUMN IF NOT EXISTS freight_sgst_amount numeric,
  ADD COLUMN IF NOT EXISTS freight_igst_amount numeric;

ALTER TABLE erp_procurement.sales_invoice_line
  ADD COLUMN IF NOT EXISTS gst_treatment text,
  ADD COLUMN IF NOT EXISTS cgst_rate numeric,
  ADD COLUMN IF NOT EXISTS sgst_rate numeric,
  ADD COLUMN IF NOT EXISTS igst_rate numeric,
  ADD COLUMN IF NOT EXISTS freight_taxable_allocation numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN erp_procurement.sales_invoice.source_freight_term IS
  'STO source freight term resolved by SO02; null for existing Sales Order invoice behavior.';
COMMENT ON COLUMN erp_procurement.sales_invoice.freight_tax_method IS
  'STO SO02 method: ADD_TO_TAXABLE_VALUE, TAX_SEPARATELY, or NO_GST.';
COMMENT ON COLUMN erp_procurement.sales_invoice.freight_amount_basis IS
  'STO freight amount authority: AGREED_SEPARATE, ACTUAL_TRANSPORTER, FIRST_MILE, TO_PAY, or FOR_INCLUDED.';
COMMENT ON COLUMN erp_procurement.sales_invoice_line.gst_treatment IS
  'SO02-resolved STO item GST treatment. Null preserves historical Sales Order behavior.';
COMMENT ON COLUMN erp_procurement.sales_invoice_line.freight_taxable_allocation IS
  'Freight allocated into this invoice line assessable value by SO02 for an STO invoice.';

-- The base completion function already owns the invoice, P601/P602,
-- reservations and dispatch reconciliation atomically. This wrapper persists
-- the SO02 commercial audit values and the STO dispatch's tracker-visible
-- transporter/LR/invoice fields in that same transaction.
CREATE OR REPLACE FUNCTION erp_procurement.complete_pgi_invoice_action_with_sto_commercials(
  p_reference_document_id uuid,
  p_postings jsonb,
  p_context jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $fn$
BEGIN
  PERFORM erp_procurement.complete_pgi_invoice_action_with_freight_to_pay(
    p_reference_document_id,
    p_postings,
    p_context
  );

  IF p_context->>'action' <> 'CREATE' THEN
    RETURN;
  END IF;

  UPDATE erp_procurement.sales_invoice
  SET source_freight_term = NULLIF(p_context->'invoice'->>'source_freight_term', ''),
      freight_tax_method = NULLIF(p_context->'invoice'->>'freight_tax_method', ''),
      freight_amount_basis = NULLIF(p_context->'invoice'->>'freight_amount_basis', ''),
      freight_taxable_value = NULLIF(p_context->'invoice'->>'freight_taxable_value', '')::numeric,
      freight_cgst_amount = NULLIF(p_context->'invoice'->>'freight_cgst_amount', '')::numeric,
      freight_sgst_amount = NULLIF(p_context->'invoice'->>'freight_sgst_amount', '')::numeric,
      freight_igst_amount = NULLIF(p_context->'invoice'->>'freight_igst_amount', '')::numeric
  WHERE id = p_reference_document_id;

  UPDATE erp_procurement.sales_invoice_line invoice_line
  SET gst_treatment = NULLIF(line->>'gst_treatment', ''),
      gst_rate = NULLIF(line->>'gst_rate', '')::numeric,
      cgst_rate = NULLIF(line->>'cgst_rate', '')::numeric,
      sgst_rate = NULLIF(line->>'sgst_rate', '')::numeric,
      igst_rate = NULLIF(line->>'igst_rate', '')::numeric,
      taxable_value = (line->>'taxable_value')::numeric,
      cgst_amount = NULLIF(line->>'cgst_amount', '')::numeric,
      sgst_amount = NULLIF(line->>'sgst_amount', '')::numeric,
      igst_amount = NULLIF(line->>'igst_amount', '')::numeric,
      line_total = (line->>'line_total')::numeric,
      freight_taxable_allocation = COALESCE(NULLIF(line->>'freight_taxable_allocation', '')::numeric, 0)
  FROM jsonb_array_elements(COALESCE(p_context->'lines', '[]'::jsonb)) AS line
  WHERE invoice_line.invoice_id = p_reference_document_id
    AND invoice_line.dc_line_id = (line->>'dc_line_id')::uuid;

  -- A CSN is linked to an STO line, while an invoice is linked to the exact
  -- dispatched DC line. Match through both links, so a mixed DO or another
  -- STO with the same material cannot overwrite this CSN. STO CSNs are
  -- domestic dispatches: mirror the DO logistics in both tracker transporter
  -- fields because a converted CSN can retain an older source value in
  -- transporter_id, which the tracker display gives precedence to. The Tally
  -- invoice is the business invoice entered in SO02; fall back to ERP's own
  -- invoice number only if it is absent.
  UPDATE erp_procurement.consignment_note csn
  SET transporter_id = dc.transporter_id,
      transporter_name_freetext = dc.transporter_name_freetext,
      domestic_transporter_id = dc.transporter_id,
      domestic_transporter_freetext = dc.transporter_name_freetext,
      lr_number = dc.lr_number,
      lr_date = dc.lr_date,
      vehicle_number = dc.vehicle_number,
      invoice_number = COALESCE(NULLIF(invoice.tally_invoice_number, ''), invoice.invoice_number),
      invoice_date = COALESCE(invoice.tally_invoice_date, invoice.invoice_date),
      last_updated_by = NULLIF(p_context->'invoice'->>'posted_by', '')::uuid,
      last_updated_at = now()
  FROM erp_procurement.sales_invoice invoice
  JOIN erp_procurement.delivery_challan dc ON dc.id = invoice.dc_id
  JOIN erp_procurement.sales_invoice_line invoice_line ON invoice_line.invoice_id = invoice.id
  JOIN erp_procurement.delivery_challan_line dc_line ON dc_line.id = invoice_line.dc_line_id
  WHERE invoice.id = p_reference_document_id
    AND dc_line.sto_line_id IS NOT NULL
    AND csn.sto_line_id = dc_line.sto_line_id
    AND csn.status NOT IN ('CAN', 'KOF');
END;
$fn$;

REVOKE ALL ON FUNCTION erp_procurement.complete_pgi_invoice_action_with_sto_commercials(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.complete_pgi_invoice_action_with_sto_commercials(uuid, jsonb, jsonb) TO service_role;

UPDATE erp_inventory.posting_source_registry
SET completion_schema = 'erp_procurement',
    completion_function = 'complete_pgi_invoice_action_with_sto_commercials'
WHERE reference_document_type = 'SALES_INVOICE';

DO $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM erp_inventory.posting_source_registry
    WHERE reference_document_type = 'SALES_INVOICE'
  ) THEN
    RAISE EXCEPTION 'SALES_INVOICE_POSTING_SOURCE_NOT_FOUND';
  END IF;
END;
$fn$;

COMMIT;
