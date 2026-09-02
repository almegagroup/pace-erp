-- Carries the new pack_qty/pack_uom_code columns (20260902110000) onto the
-- permanent posted invoice line too, same display-only pattern as
-- display_rate_basis. Extends complete_pgi_invoice_action() (last touched
-- by 20260901150000) purely to persist these two columns on the CREATE
-- branch's sales_invoice_line insert -- no other statement changes.
CREATE OR REPLACE FUNCTION erp_procurement.complete_pgi_invoice_action(p_reference_document_id uuid, p_postings jsonb, p_context jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'erp_procurement', 'erp_production', 'public'
AS $function$
DECLARE
  v_action text := p_context->>'action';
  v_dc_id  uuid := NULLIF(p_context->>'dc_id', '')::uuid;
  v_inv    jsonb := p_context->'invoice';
  v_cancel jsonb := p_context->'cancel';
  v_remaining_active_invoices int;
BEGIN
  IF v_action = 'CREATE' THEN
    INSERT INTO erp_procurement.sales_invoice (
      id, invoice_number, invoice_date, company_id, customer_id, sto_id, dc_id, so_id,
      payment_term_id, gst_type,
      bill_to_name, bill_to_address, bill_to_state, bill_to_gst_number,
      ship_to_name, ship_to_address, ship_to_state, ship_to_gst_number,
      tally_invoice_number, tally_invoice_date, freight_included, freight_amount,
      total_taxable_value, total_cgst_amount, total_sgst_amount, total_igst_amount,
      total_gst_amount, total_invoice_value, status, posted_by, posted_at, remarks, created_by,
      inbound_number, e_way_bill_applicable, e_way_bill_number,
      freight_mode, freight_rate, freight_net_weight,
      freight_gst_included, freight_gst_treatment, freight_gst_rate, freight_gst_amount,
      additional_cost_total, round_off_amount, fo_id, fo_number, fo_date
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
      (v_inv->>'created_by')::uuid,
      NULLIF(v_inv->>'inbound_number', ''),
      COALESCE((v_inv->>'e_way_bill_applicable')::boolean, false),
      NULLIF(v_inv->>'e_way_bill_number', ''),
      NULLIF(v_inv->>'freight_mode', ''),
      NULLIF(v_inv->>'freight_rate', '')::numeric,
      NULLIF(v_inv->>'freight_net_weight', '')::numeric,
      COALESCE((v_inv->>'freight_gst_included')::boolean, false),
      NULLIF(v_inv->>'freight_gst_treatment', ''),
      NULLIF(v_inv->>'freight_gst_rate', '')::numeric,
      NULLIF(v_inv->>'freight_gst_amount', '')::numeric,
      COALESCE(NULLIF(v_inv->>'additional_cost_total', '')::numeric, 0),
      COALESCE(NULLIF(v_inv->>'round_off_amount', '')::numeric, 0),
      NULLIF(v_inv->>'fo_id', '')::uuid,
      NULLIF(v_inv->>'fo_number', ''),
      NULLIF(v_inv->>'fo_date', '')::date
    );

    INSERT INTO erp_procurement.sales_invoice_line (
      id, invoice_id, line_number, so_line_id, dc_line_id, material_id, quantity, uom_code, rate,
      display_rate_basis, display_rate, display_uom_code, pack_qty, pack_uom_code,
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
      NULLIF(line->>'display_rate_basis', ''),
      NULLIF(line->>'display_rate', '')::numeric,
      NULLIF(line->>'display_uom_code', ''),
      NULLIF(line->>'pack_qty', '')::numeric,
      NULLIF(line->>'pack_uom_code', ''),
      (line->>'taxable_value')::numeric,
      NULLIF(line->>'gst_rate', '')::numeric,
      NULLIF(line->>'cgst_amount', '')::numeric,
      NULLIF(line->>'sgst_amount', '')::numeric,
      NULLIF(line->>'igst_amount', '')::numeric,
      (line->>'line_total')::numeric
    FROM jsonb_array_elements(p_context->'lines') AS line;

    INSERT INTO erp_procurement.sales_invoice_additional_cost_line (
      id, invoice_id, category_id, amount, gst_included, gst_treatment, gst_rate, gst_amount, line_total
    )
    SELECT
      gen_random_uuid(),
      p_reference_document_id,
      (ac->>'category_id')::uuid,
      (ac->>'amount')::numeric,
      COALESCE((ac->>'gst_included')::boolean, false),
      NULLIF(ac->>'gst_treatment', ''),
      NULLIF(ac->>'gst_rate', '')::numeric,
      NULLIF(ac->>'gst_amount', '')::numeric,
      (ac->>'line_total')::numeric
    FROM jsonb_array_elements(COALESCE(p_context->'additional_cost_lines', '[]'::jsonb)) AS ac;

    -- §133.14 Part B -- one row per underlying RM/PM/INT material, already
    -- fully computed (2-level ratio or simple RPS-Asian passthrough) by
    -- do_unified.handlers.ts's computeDispatchRecoRows() before this call --
    -- this is a pure write, no derivation happens in SQL.
    INSERT INTO erp_production.dispatch_reco (
      id, company_id, invoice_id, invoice_number, invoice_date, tally_invoice_number, tally_invoice_date,
      inbound_number, dc_id, dc_number, source_type, so_id, so_number, fo_id, fo_number, dispatch_category,
      process_order_id, process_order_number, batch_number, packing_order_id, packing_order_number, po_type,
      dispatch_qty_kg, material_id, line_material_type, standard_qty, actual_qty, ap_approved_qty, created_by
    )
    SELECT
      gen_random_uuid(),
      (v_inv->>'company_id')::uuid,
      p_reference_document_id,
      v_inv->>'invoice_number',
      (v_inv->>'invoice_date')::date,
      dr->>'tally_invoice_number',
      NULLIF(dr->>'tally_invoice_date', '')::date,
      NULLIF(dr->>'inbound_number', ''),
      v_dc_id,
      dr->>'dc_number',
      'SALES_ORDER',
      NULLIF(dr->>'so_id', '')::uuid,
      dr->>'so_number',
      NULLIF(dr->>'fo_id', '')::uuid,
      dr->>'fo_number',
      dr->>'dispatch_category',
      NULLIF(dr->>'process_order_id', '')::uuid,
      dr->>'process_order_number',
      dr->>'batch_number',
      NULLIF(dr->>'packing_order_id', '')::uuid,
      dr->>'packing_order_number',
      dr->>'po_type',
      (dr->>'dispatch_qty_kg')::numeric,
      (dr->>'material_id')::uuid,
      dr->>'line_material_type',
      NULLIF(dr->>'standard_qty', '')::numeric,
      NULLIF(dr->>'actual_qty', '')::numeric,
      NULLIF(dr->>'ap_approved_qty', '')::numeric,
      (v_inv->>'created_by')::uuid
    FROM jsonb_array_elements(COALESCE(p_context->'dispatch_reco_lines', '[]'::jsonb)) AS dr;

    UPDATE erp_production.reservation_document rd
    SET status = 'FULLY_ISSUED',
        issued_qty = (r->>'issued_qty')::numeric,
        last_updated_at = now(),
        last_updated_by = NULLIF(v_inv->>'posted_by', '')::uuid
    FROM jsonb_array_elements(COALESCE(p_context->'reservations', '[]'::jsonb)) AS r
    WHERE rd.source_line_id = (r->>'source_line_id')::uuid
      AND rd.status IN ('OPEN', 'PARTIAL');

    IF COALESCE(p_context->>'is_final_group', 'true') = 'true' THEN
      UPDATE erp_procurement.delivery_challan
      SET status = 'DISPATCHED'
      WHERE id = v_dc_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PGI_INVOICE_DC_NOT_FOUND: %', v_dc_id;
      END IF;
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

    -- §133.15 point 2 -- void, never delete (PR19/COR6's own established
    -- pattern, already mirrored by this same table's is_voided/voided_at
    -- columns). A no-op (0 rows) is expected and fine for a legacy
    -- §113.15 invoice or an RPS/STO dispatch that never got a Reco row.
    UPDATE erp_production.dispatch_reco
    SET is_voided = true,
        voided_at = COALESCE((v_cancel->>'cancelled_at')::timestamptz, now()),
        voided_by = NULLIF(v_cancel->>'cancelled_by', '')::uuid
    WHERE invoice_id = p_reference_document_id
      AND is_voided = false;

    IF v_dc_id IS NOT NULL THEN
      SELECT count(*) INTO v_remaining_active_invoices
      FROM erp_procurement.sales_invoice
      WHERE dc_id = v_dc_id AND status IN ('DRAFT', 'POSTED');
      IF v_remaining_active_invoices = 0 THEN
        UPDATE erp_procurement.delivery_challan
        SET status = 'CREATED'
        WHERE id = v_dc_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'PGI_INVOICE_REVERSE_DC_NOT_FOUND: %', v_dc_id;
        END IF;
      END IF;
    END IF;

  ELSE
    RAISE EXCEPTION 'PGI_INVOICE_ACTION_UNKNOWN: %', v_action;
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';
