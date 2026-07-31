-- ============================================================================
-- complete_pgi_invoice_action — PGI+Invoice create/reverse business writes,
-- called by post_document() inside the SAME transaction as the P601/P602
-- stock postings (CLAUDE.md 8D, feasibility §107.8 -- same shape as
-- erp_production.complete_process_po_verify).
--
-- Migrates supabase/functions/api/_core/procurement/delivery_order.handlers.ts's
-- createPgiInvoiceHandler / reverseSalesInvoiceHandler off direct
-- post_stock_movement calls (was failing the CI stock-posting-guard ratchet,
-- and for real reasons -- a create/reverse used to be ~3-15 separate commits,
-- so an interrupted request could leave stock posted with no invoice row, or
-- an invoice with no stock movement).
--
-- One function handles BOTH actions (create vs. reverse), dispatched by
-- p_context->>'action' -- the registry only allows one completion_function
-- per reference_document_type, and both actions legitimately tag their
-- postings as reference_document_type='SALES_INVOICE' against the same
-- invoice id (matches how every other create/CORS pair in this codebase
-- tags reversal legs under the original document's own type).
--
-- Same design rule as the Process PO Verify precedent: calculations
-- (GST split, freight, bill-to/ship-to resolution, which lines to post)
-- STAY in TypeScript. Only the WRITE moves here.
-- ============================================================================

CREATE OR REPLACE FUNCTION erp_procurement.complete_pgi_invoice_action(
  p_reference_document_id uuid,
  p_postings               jsonb,   -- post_document's result; unused here (sales_invoice_line has no stock_ledger_id column to attach)
  p_context                jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $fn$
DECLARE
  v_action text := p_context->>'action';
  v_dc_id  uuid := NULLIF(p_context->>'dc_id', '')::uuid;
  v_inv    jsonb := p_context->'invoice';
  v_cancel jsonb := p_context->'cancel';
BEGIN
  -- No EXCEPTION handler, same as post_document / complete_process_po_verify
  -- -- any failure here rolls back the whole transaction, stock movements
  -- included. That's the entire point of this migration.

  IF v_action = 'CREATE' THEN
    INSERT INTO erp_procurement.sales_invoice (
      id, invoice_number, invoice_date, company_id, customer_id, sto_id, dc_id, so_id,
      payment_term_id, gst_type,
      bill_to_name, bill_to_address, bill_to_state, bill_to_gst_number,
      ship_to_name, ship_to_address, ship_to_state, ship_to_gst_number,
      tally_invoice_number, tally_invoice_date, freight_included, freight_amount,
      total_taxable_value, total_cgst_amount, total_sgst_amount, total_igst_amount,
      total_gst_amount, total_invoice_value, status, posted_by, posted_at, remarks, created_by
    )
    VALUES (
      p_reference_document_id,
      v_inv->>'invoice_number',
      (v_inv->>'invoice_date')::date,
      (v_inv->>'company_id')::uuid,
      NULLIF(v_inv->>'customer_id', '')::uuid,
      NULLIF(v_inv->>'sto_id', '')::uuid,
      (v_inv->>'dc_id')::uuid,
      NULLIF(v_inv->>'so_id', '')::uuid,
      NULLIF(v_inv->>'payment_term_id', '')::uuid,
      v_inv->>'gst_type',
      v_inv->>'bill_to_name', v_inv->>'bill_to_address', v_inv->>'bill_to_state', v_inv->>'bill_to_gst_number',
      v_inv->>'ship_to_name', v_inv->>'ship_to_address', v_inv->>'ship_to_state', v_inv->>'ship_to_gst_number',
      v_inv->>'tally_invoice_number',
      (v_inv->>'tally_invoice_date')::date,
      COALESCE((v_inv->>'freight_included')::boolean, false),
      NULLIF(v_inv->>'freight_amount', '')::numeric,
      NULLIF(v_inv->>'total_taxable_value', '')::numeric,
      NULLIF(v_inv->>'total_cgst_amount', '')::numeric,
      NULLIF(v_inv->>'total_sgst_amount', '')::numeric,
      NULLIF(v_inv->>'total_igst_amount', '')::numeric,
      NULLIF(v_inv->>'total_gst_amount', '')::numeric,
      NULLIF(v_inv->>'total_invoice_value', '')::numeric,
      'POSTED',
      NULLIF(v_inv->>'posted_by', '')::uuid,
      COALESCE((v_inv->>'posted_at')::timestamptz, now()),
      NULLIF(v_inv->>'remarks', ''),
      (v_inv->>'created_by')::uuid
    );

    INSERT INTO erp_procurement.sales_invoice_line (
      id, invoice_id, line_number, so_line_id, dc_line_id, material_id, quantity, uom_code, rate,
      taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, line_total
    )
    SELECT
      gen_random_uuid(),
      p_reference_document_id,
      (line->>'line_number')::int,
      NULLIF(line->>'so_line_id', '')::uuid,
      NULLIF(line->>'dc_line_id', '')::uuid,
      (line->>'material_id')::uuid,
      (line->>'quantity')::numeric,
      line->>'uom_code',
      (line->>'rate')::numeric,
      (line->>'taxable_value')::numeric,
      NULLIF(line->>'gst_rate', '')::numeric,
      NULLIF(line->>'cgst_amount', '')::numeric,
      NULLIF(line->>'sgst_amount', '')::numeric,
      NULLIF(line->>'igst_amount', '')::numeric,
      (line->>'line_total')::numeric
    FROM jsonb_array_elements(p_context->'lines') AS line;

    -- Close the reservation each DO line opened at create time (§83.5) --
    -- physical stock has now actually left, so leaving OPEN/PARTIAL would
    -- keep blocking a later DO's availability check indefinitely.
    UPDATE erp_production.reservation_document rd
    SET status = 'FULLY_ISSUED',
        issued_qty = (r->>'issued_qty')::numeric,
        last_updated_at = now(),
        last_updated_by = NULLIF(v_inv->>'posted_by', '')::uuid
    FROM jsonb_array_elements(COALESCE(p_context->'reservations', '[]'::jsonb)) AS r
    WHERE rd.source_line_id = (r->>'source_line_id')::uuid
      AND rd.status IN ('OPEN', 'PARTIAL');

    UPDATE erp_procurement.delivery_challan
    SET status = 'DISPATCHED'
    WHERE id = v_dc_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PGI_INVOICE_DC_NOT_FOUND: %', v_dc_id;
    END IF;

  ELSIF v_action = 'REVERSE' THEN
    UPDATE erp_procurement.sales_invoice
    SET status = 'CANCELLED',
        cancelled_by = NULLIF(v_cancel->>'cancelled_by', '')::uuid,
        cancelled_at = COALESCE((v_cancel->>'cancelled_at')::timestamptz, now()),
        cancellation_reason = v_cancel->>'cancellation_reason',
        last_updated_at = now()
    WHERE id = p_reference_document_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SALES_INVOICE_REVERSE_NOT_FOUND: %', p_reference_document_id;
    END IF;

    IF v_dc_id IS NOT NULL THEN
      UPDATE erp_procurement.delivery_challan
      SET status = 'CREATED'
      WHERE id = v_dc_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PGI_INVOICE_REVERSE_DC_NOT_FOUND: %', v_dc_id;
      END IF;
    END IF;

  ELSE
    RAISE EXCEPTION 'PGI_INVOICE_ACTION_UNKNOWN: %', v_action;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION erp_procurement.complete_pgi_invoice_action(uuid, jsonb, jsonb) IS
  'post_document একই transaction-এ ডাকে। PGI+Invoice create ও reversal দুটোরই business write (action দিয়ে dispatch) -- feasibility §107.8/§113.15.';

REVOKE ALL ON FUNCTION erp_procurement.complete_pgi_invoice_action(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.complete_pgi_invoice_action(uuid, jsonb, jsonb) TO service_role;

-- Register SALES_INVOICE as a post_document source -- was never registered
-- at all (the direct-call handler predates the registry's existence),
-- meaning its P601/P602 legs were already silently failing the Tier-2
-- "unregistered posting source" health check (CLAUDE.md 8D step 2).
INSERT INTO erp_inventory.posting_source_registry (
  reference_document_type, label, source_schema, source_table, status_column,
  suspect_statuses, is_active, completion_schema, completion_function
) VALUES (
  'SALES_INVOICE', 'Sales/STO Invoice (PGI)', 'erp_procurement', 'sales_invoice', 'status',
  ARRAY['DRAFT'], true, 'erp_procurement', 'complete_pgi_invoice_action'
)
ON CONFLICT (reference_document_type) DO UPDATE
SET completion_schema = EXCLUDED.completion_schema,
    completion_function = EXCLUDED.completion_function;
