-- VDC Bulk Dispatch: invoice now; PGI is deliberately deferred until the
-- truck and dispatch date are confirmed. This is separate from, and never
-- modifies, the existing atomic PGI+Invoice transaction used by DC/RM/PM/INT.
CREATE OR REPLACE FUNCTION erp_procurement.create_vdc_invoice_only_atomic(p_groups jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $function$
DECLARE
  v_group jsonb;
  v_inv jsonb;
  v_invoice_id uuid;
  v_invoice_number text;
  v_dc_id uuid;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array' OR jsonb_array_length(p_groups) = 0 THEN
    RAISE EXCEPTION 'VDC_INVOICE_GROUPS_INVALID';
  END IF;

  FOR v_group IN SELECT value FROM jsonb_array_elements(p_groups) LOOP
    v_inv := v_group->'invoice';
    v_dc_id := NULLIF(v_inv->>'dc_id', '')::uuid;
    IF v_dc_id IS NULL OR NULLIF(v_inv->>'company_id', '') IS NULL THEN
      RAISE EXCEPTION 'VDC_INVOICE_GROUP_CONTEXT_INVALID';
    END IF;
    PERFORM 1 FROM erp_procurement.delivery_challan
      WHERE id = v_dc_id AND status = 'CREATED' AND pgi_deferred = true AND is_bulk_uploaded = true
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VDC_INVOICE_DO_NOT_READY'; END IF;

    v_invoice_id := gen_random_uuid();
    SELECT erp_procurement.generate_doc_number('SALES_INVOICE') INTO v_invoice_number;
    INSERT INTO erp_procurement.sales_invoice (
      id, invoice_number, invoice_date, company_id, customer_id, dc_id, so_id,
      payment_term_id, gst_type,
      bill_to_name, bill_to_address, bill_to_state, bill_to_gst_number,
      ship_to_name, ship_to_address, ship_to_state, ship_to_gst_number,
      tally_invoice_number, tally_invoice_date, inbound_number,
      total_taxable_value, total_cgst_amount, total_sgst_amount, total_igst_amount,
      total_gst_amount, total_invoice_value, status, round_off_amount,
      fo_id, fo_number, fo_date, created_by
    ) VALUES (
      v_invoice_id, v_invoice_number, COALESCE(NULLIF(v_inv->>'invoice_date', '')::date, current_date),
      (v_inv->>'company_id')::uuid, NULLIF(v_inv->>'customer_id', '')::uuid, v_dc_id,
      NULLIF(v_inv->>'so_id', '')::uuid, NULLIF(v_inv->>'payment_term_id', '')::uuid, v_inv->>'gst_type',
      NULLIF(v_inv->>'bill_to_name', ''), NULLIF(v_inv->>'bill_to_address', ''), NULLIF(v_inv->>'bill_to_state', ''), NULLIF(v_inv->>'bill_to_gst_number', ''),
      NULLIF(v_inv->>'ship_to_name', ''), NULLIF(v_inv->>'ship_to_address', ''), NULLIF(v_inv->>'ship_to_state', ''), NULLIF(v_inv->>'ship_to_gst_number', ''),
      NULLIF(v_inv->>'tally_invoice_number', ''), NULLIF(v_inv->>'tally_invoice_date', '')::date, NULLIF(v_inv->>'inbound_number', ''),
      NULLIF(v_inv->>'total_taxable_value', '')::numeric, NULLIF(v_inv->>'total_cgst_amount', '')::numeric,
      NULLIF(v_inv->>'total_sgst_amount', '')::numeric, NULLIF(v_inv->>'total_igst_amount', '')::numeric,
      NULLIF(v_inv->>'total_gst_amount', '')::numeric, NULLIF(v_inv->>'total_invoice_value', '')::numeric,
      'DRAFT', COALESCE(NULLIF(v_inv->>'round_off_amount', '')::numeric, 0),
      NULLIF(v_inv->>'fo_id', '')::uuid, NULLIF(v_inv->>'fo_number', ''), NULLIF(v_inv->>'fo_date', '')::date,
      (v_inv->>'created_by')::uuid
    );
    INSERT INTO erp_procurement.sales_invoice_line (
      id, invoice_id, line_number, so_line_id, dc_line_id, material_id, quantity, uom_code, rate,
      display_rate_basis, display_rate, display_uom_code, pack_qty, pack_uom_code,
      taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, line_total
    )
    SELECT gen_random_uuid(), v_invoice_id, (line->>'line_number')::int,
      NULLIF(line->>'so_line_id', '')::uuid, NULLIF(line->>'dc_line_id', '')::uuid,
      (line->>'material_id')::uuid, (line->>'quantity')::numeric, line->>'uom_code', (line->>'rate')::numeric,
      NULLIF(line->>'display_rate_basis', ''), NULLIF(line->>'display_rate', '')::numeric, NULLIF(line->>'display_uom_code', ''),
      NULLIF(line->>'pack_qty', '')::numeric, NULLIF(line->>'pack_uom_code', ''),
      (line->>'taxable_value')::numeric, NULLIF(line->>'gst_rate', '')::numeric,
      NULLIF(line->>'cgst_amount', '')::numeric, NULLIF(line->>'sgst_amount', '')::numeric,
      NULLIF(line->>'igst_amount', '')::numeric, (line->>'line_total')::numeric
    FROM jsonb_array_elements(v_group->'lines') AS line;
    -- Reconciliation is written at invoice time. Unlike a P601, it does not
    -- reserve or issue stock; the later PGI action owns physical movement.
    INSERT INTO erp_production.dispatch_reco (
      id, company_id, invoice_id, invoice_number, invoice_date, tally_invoice_number, tally_invoice_date,
      inbound_number, dc_id, dc_number, source_type, so_id, so_number, fo_id, fo_number, dispatch_category,
      process_order_id, process_order_number, batch_number, packing_order_id, packing_order_number, po_type,
      dispatch_qty_kg, material_id, line_material_type, standard_qty, actual_qty, ap_approved_qty, is_asian_billed, created_by
    )
    SELECT gen_random_uuid(), (v_inv->>'company_id')::uuid, v_invoice_id, v_invoice_number,
      (v_inv->>'invoice_date')::date, dr->>'tally_invoice_number', NULLIF(dr->>'tally_invoice_date', '')::date,
      NULLIF(dr->>'inbound_number', ''), v_dc_id, dr->>'dc_number', 'SALES_ORDER',
      NULLIF(dr->>'so_id', '')::uuid, dr->>'so_number', NULLIF(dr->>'fo_id', '')::uuid, dr->>'fo_number', dr->>'dispatch_category',
      NULLIF(dr->>'process_order_id', '')::uuid, dr->>'process_order_number', dr->>'batch_number',
      NULLIF(dr->>'packing_order_id', '')::uuid, dr->>'packing_order_number', dr->>'po_type',
      (dr->>'dispatch_qty_kg')::numeric, (dr->>'material_id')::uuid, dr->>'line_material_type',
      NULLIF(dr->>'standard_qty', '')::numeric, NULLIF(dr->>'actual_qty', '')::numeric,
      NULLIF(dr->>'ap_approved_qty', '')::numeric, COALESCE((dr->>'is_asian_billed')::boolean, true), (v_inv->>'created_by')::uuid
    FROM jsonb_array_elements(COALESCE(v_group->'dispatch_reco_lines', '[]'::jsonb)) AS dr;
    v_results := v_results || jsonb_build_array(jsonb_build_object('invoice_id', v_invoice_id, 'invoice_number', v_invoice_number));
  END LOOP;
  UPDATE erp_procurement.delivery_challan SET status = 'INVOICED' WHERE id = v_dc_id;
  RETURN v_results;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.create_vdc_invoice_only_atomic(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.create_vdc_invoice_only_atomic(jsonb) TO service_role;
