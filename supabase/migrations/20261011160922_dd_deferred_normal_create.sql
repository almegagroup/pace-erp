-- A DD Direct DO can originate from normal SO03 or Bulk DO Upload.  The
-- deferred commercial/physical split is common; only the audit flag differs.
-- Keep this function separate from the established atomic DO function.
CREATE OR REPLACE FUNCTION erp_procurement.save_vdc_deferred_bulk_delivery_order_atomic(
  p_header jsonb, p_sources jsonb, p_lines jsonb, p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'erp_procurement', 'erp_production', 'public'
AS $function$
DECLARE v_dc_id uuid; v_line jsonb;
BEGIN
  IF COALESCE(p_header->>'dc_type', '') <> 'SALES'
     OR NULLIF(p_header->>'selling_company_id', '') IS NULL
     OR jsonb_typeof(COALESCE(p_sources, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_sources, '[]'::jsonb)) <> 1
     OR EXISTS (SELECT 1 FROM jsonb_to_recordset(COALESCE(p_sources, '[]'::jsonb)) AS s(source_type text, source_id uuid) WHERE s.source_type <> 'SALES_ORDER' OR s.source_id IS NULL)
  THEN RAISE EXCEPTION 'VDC_DEFERRED_DO_SOURCE_INVALID'; END IF;
  IF jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN RAISE EXCEPTION 'VDC_DEFERRED_DO_LINES_REQUIRED'; END IF;

  INSERT INTO erp_procurement.delivery_challan (
    dc_number, dc_date, dc_type, selling_company_id, vehicle_number, transporter_id, transporter_name_freetext,
    lr_number, lr_date, gross_weight, net_weight, driver_number, driver_contact_number, status, remarks,
    is_bulk_uploaded, pgi_deferred
  ) VALUES (
    p_header->>'dc_number', (p_header->>'dc_date')::date, 'SALES', (p_header->>'selling_company_id')::uuid,
    NULLIF(p_header->>'vehicle_number', ''), NULLIF(p_header->>'transporter_id', '')::uuid, NULLIF(p_header->>'transporter_name_freetext', ''),
    NULLIF(p_header->>'lr_number', ''), NULLIF(p_header->>'lr_date', '')::date, NULLIF(p_header->>'gross_weight', '')::numeric,
    (p_header->>'net_weight')::numeric, NULLIF(p_header->>'driver_number', ''), NULLIF(p_header->>'driver_contact_number', ''),
    'CREATED', NULLIF(p_header->>'remarks', ''), COALESCE((p_header->>'is_bulk_uploaded')::boolean, false), true
  ) RETURNING id INTO v_dc_id;

  INSERT INTO erp_procurement.delivery_challan_source (dc_id, source_type, source_id)
  SELECT v_dc_id, source_type, source_id FROM jsonb_to_recordset(p_sources) AS s(source_type text, source_id uuid);
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF NULLIF(v_line->>'so_line_id', '') IS NULL OR NULLIF(v_line->>'sto_line_id', '') IS NOT NULL THEN RAISE EXCEPTION 'VDC_DEFERRED_DO_LINE_SOURCE_INVALID'; END IF;
    INSERT INTO erp_procurement.delivery_challan_line (
      dc_id, line_number, material_id, so_line_id, sto_line_id, so_map_allocation_id, quantity, uom_code,
      storage_location_id, batch_number, expiry_date, packing_order_id, unit_value, gst_rate, gst_amount, line_total,
      ship_to_customer_id, ship_to_name, ship_to_address, ship_to_state, ship_to_gst_number,
      display_rate_basis, display_rate, display_uom_code, pack_qty, pack_uom_code, urgent_dispatch_decision
    ) VALUES (
      v_dc_id, (v_line->>'line_number')::int, (v_line->>'material_id')::uuid, NULLIF(v_line->>'so_line_id', '')::uuid, NULL,
      NULLIF(v_line->>'so_map_allocation_id', '')::uuid, (v_line->>'quantity')::numeric, v_line->>'uom_code',
      (v_line->>'storage_location_id')::uuid, NULLIF(v_line->>'batch_number', ''), NULLIF(v_line->>'expiry_date', '')::date,
      NULLIF(v_line->>'packing_order_id', '')::uuid, (v_line->>'unit_value')::numeric, (v_line->>'gst_rate')::numeric,
      (v_line->>'gst_amount')::numeric, (v_line->>'line_total')::numeric, NULLIF(v_line->>'ship_to_customer_id', '')::uuid,
      NULLIF(v_line->>'ship_to_name', ''), NULLIF(v_line->>'ship_to_address', ''), NULLIF(v_line->>'ship_to_state', ''),
      NULLIF(v_line->>'ship_to_gst_number', ''), NULLIF(v_line->>'display_rate_basis', ''), NULLIF(v_line->>'display_rate', '')::numeric,
      NULLIF(v_line->>'display_uom_code', ''), NULLIF(v_line->>'pack_qty', '')::numeric, NULLIF(v_line->>'pack_uom_code', ''),
      NULLIF(v_line->>'urgent_dispatch_decision', '')
    );
  END LOOP;
  RETURN v_dc_id;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.save_vdc_deferred_bulk_delivery_order_atomic(jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.save_vdc_deferred_bulk_delivery_order_atomic(jsonb, jsonb, jsonb, uuid) TO service_role;

-- The invoice-only function was originally guarded by `is_bulk_uploaded`.
-- The DD lifecycle is now shared by normal SO03 and Bulk Upload, while the
-- durable `pgi_deferred` marker remains the actual eligibility check.  Use
-- pg_get_functiondef so this surgical guard removal preserves the complete
-- established invoice/reconciliation implementation verbatim.
DO $block$
DECLARE v_definition text;
BEGIN
  SELECT pg_get_functiondef('erp_procurement.create_vdc_invoice_only_atomic(jsonb)'::regprocedure)
    INTO v_definition;
  v_definition := regexp_replace(v_definition, E'\\s+AND\\s+is_bulk_uploaded\\s*=\\s*true', '', 'g');
  EXECUTE v_definition;
END;
$block$;
