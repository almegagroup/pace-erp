-- VDC Bulk DOs whose Truck Number or Dispatch Date is still missing are a
-- separate physical state: preserve the DO and its source allocations, but
-- do not run a stock check or create a reservation until the deferred PGI.
-- This function is intentionally separate from save_delivery_order_unified_
-- atomic so existing DO01/DC/RM/PM/INT behaviour stays untouched.
CREATE OR REPLACE FUNCTION erp_procurement."save_vdc_deferred_bulk_delivery_order_atomic"(
  p_header jsonb,
  p_sources jsonb,
  p_lines jsonb,
  p_actor uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'erp_procurement', 'erp_production', 'public'
AS $function$
DECLARE
  v_dc_id uuid;
  v_line jsonb;
BEGIN
  IF COALESCE(p_header->>'dc_type', '') <> 'SALES'
     OR NULLIF(p_header->>'selling_company_id', '') IS NULL
     OR jsonb_typeof(COALESCE(p_sources, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_sources, '[]'::jsonb)) <> 1
     OR EXISTS (
       SELECT 1 FROM jsonb_to_recordset(COALESCE(p_sources, '[]'::jsonb))
         AS s(source_type text, source_id uuid)
       WHERE s.source_type <> 'SALES_ORDER' OR s.source_id IS NULL
     )
  THEN
    RAISE EXCEPTION 'VDC_DEFERRED_DO_SOURCE_INVALID';
  END IF;

  IF jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'VDC_DEFERRED_DO_LINES_REQUIRED';
  END IF;

  INSERT INTO erp_procurement.delivery_challan (
    dc_number, dc_date, dc_type, selling_company_id, vehicle_number,
    transporter_id, transporter_name_freetext, lr_number, lr_date,
    gross_weight, net_weight, driver_number, driver_contact_number, status, remarks,
    is_bulk_uploaded, pgi_deferred
  ) VALUES (
    p_header->>'dc_number', (p_header->>'dc_date')::date, 'SALES',
    (p_header->>'selling_company_id')::uuid, NULLIF(p_header->>'vehicle_number', ''),
    NULLIF(p_header->>'transporter_id', '')::uuid, NULLIF(p_header->>'transporter_name_freetext', ''),
    NULLIF(p_header->>'lr_number', ''), NULLIF(p_header->>'lr_date', '')::date,
    NULLIF(p_header->>'gross_weight', '')::numeric, (p_header->>'net_weight')::numeric,
    NULLIF(p_header->>'driver_number', ''), NULLIF(p_header->>'driver_contact_number', ''),
    'CREATED', NULLIF(p_header->>'remarks', ''), true, true
  ) RETURNING id INTO v_dc_id;

  INSERT INTO erp_procurement.delivery_challan_source (dc_id, source_type, source_id)
  SELECT v_dc_id, source_type, source_id
  FROM jsonb_to_recordset(p_sources) AS s(source_type text, source_id uuid);

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF NULLIF(v_line->>'so_line_id', '') IS NULL OR NULLIF(v_line->>'sto_line_id', '') IS NOT NULL THEN
      RAISE EXCEPTION 'VDC_DEFERRED_DO_LINE_SOURCE_INVALID';
    END IF;
    INSERT INTO erp_procurement.delivery_challan_line (
      dc_id, line_number, material_id, so_line_id, sto_line_id, so_map_allocation_id,
      quantity, uom_code, storage_location_id, batch_number, expiry_date, packing_order_id,
      unit_value, gst_rate, gst_amount, line_total, ship_to_customer_id, ship_to_name,
      ship_to_address, ship_to_state, ship_to_gst_number,
      display_rate_basis, display_rate, display_uom_code, pack_qty, pack_uom_code,
      urgent_dispatch_decision
    ) VALUES (
      v_dc_id, (v_line->>'line_number')::int, (v_line->>'material_id')::uuid,
      NULLIF(v_line->>'so_line_id', '')::uuid, NULL, NULLIF(v_line->>'so_map_allocation_id', '')::uuid,
      (v_line->>'quantity')::numeric, v_line->>'uom_code', (v_line->>'storage_location_id')::uuid,
      NULLIF(v_line->>'batch_number', ''), NULLIF(v_line->>'expiry_date', '')::date,
      NULLIF(v_line->>'packing_order_id', '')::uuid, (v_line->>'unit_value')::numeric,
      (v_line->>'gst_rate')::numeric, (v_line->>'gst_amount')::numeric,
      (v_line->>'line_total')::numeric, NULLIF(v_line->>'ship_to_customer_id', '')::uuid,
      NULLIF(v_line->>'ship_to_name', ''), NULLIF(v_line->>'ship_to_address', ''),
      NULLIF(v_line->>'ship_to_state', ''), NULLIF(v_line->>'ship_to_gst_number', ''),
      NULLIF(v_line->>'display_rate_basis', ''), NULLIF(v_line->>'display_rate', '')::numeric,
      NULLIF(v_line->>'display_uom_code', ''), NULLIF(v_line->>'pack_qty', '')::numeric,
      NULLIF(v_line->>'pack_uom_code', ''), NULLIF(v_line->>'urgent_dispatch_decision', '')
    );
  END LOOP;

  RETURN v_dc_id;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement."save_vdc_deferred_bulk_delivery_order_atomic"(jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement."save_vdc_deferred_bulk_delivery_order_atomic"(jsonb, jsonb, jsonb, uuid) TO service_role;

-- A dedicated posting source keeps the VDC deferred action outside the live
-- SALES_INVOICE completion chain. post_document() still owns P601 and this
-- completion write in one transaction, but CREATE/REVERSE for every existing
-- sales invoice continue through their registered function unchanged.
CREATE OR REPLACE FUNCTION erp_procurement.complete_vdc_pgi_only_action(
  p_reference_document_id uuid,
  p_postings jsonb,
  p_context jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'erp_procurement', 'erp_production', 'public'
AS $function$
DECLARE
  v_dc_id uuid := NULLIF(p_context->>'dc_id', '')::uuid;
BEGIN
  IF p_context->>'action' <> 'PGI_ONLY' OR v_dc_id IS NULL THEN
    RAISE EXCEPTION 'VDC_PGI_ONLY_CONTEXT_INVALID';
  END IF;

  UPDATE erp_procurement.sales_invoice
  SET status = 'POSTED',
      posted_by = NULLIF(p_context->'invoice'->>'posted_by', '')::uuid,
      posted_at = now(),
      last_updated_at = now()
  WHERE id = p_reference_document_id
    AND dc_id = v_dc_id
    AND status = 'DRAFT';
  IF NOT FOUND THEN RAISE EXCEPTION 'VDC_PGI_ONLY_INVOICE_NOT_DRAFT'; END IF;

  -- Rows already exist when VDC had both Truck and Dispatch Date during
  -- Bulk-DO creation; deferred VDC creates the same audit row only now.
  UPDATE erp_production.reservation_document rd
  SET issued_qty = sil.quantity,
      status = 'FULLY_ISSUED',
      last_updated_at = now(),
      last_updated_by = NULLIF(p_context->'invoice'->>'posted_by', '')::uuid
  FROM erp_procurement.sales_invoice_line sil
  WHERE sil.invoice_id = p_reference_document_id
    AND rd.dc_line_id = sil.dc_line_id
    AND rd.status IN ('OPEN', 'PARTIAL', 'FULLY_ISSUED');

  INSERT INTO erp_production.reservation_document (
    dc_line_id, source_type, source_id, source_line_id, company_id, material_id,
    storage_location_id, batch_number, packing_order_id, required_qty, uom_code,
    issued_qty, status, created_by, created_at, last_updated_by, last_updated_at
  )
  SELECT dcl.id, 'SALES_ORDER', si.so_id, dcl.so_line_id, si.company_id,
    dcl.material_id, dcl.storage_location_id, dcl.batch_number,
    dcl.packing_order_id, sil.quantity, sil.uom_code, sil.quantity,
    'FULLY_ISSUED', NULLIF(p_context->'invoice'->>'posted_by', '')::uuid,
    now(), NULLIF(p_context->'invoice'->>'posted_by', '')::uuid, now()
  FROM erp_procurement.sales_invoice si
  JOIN erp_procurement.sales_invoice_line sil ON sil.invoice_id = si.id
  JOIN erp_procurement.delivery_challan_line dcl ON dcl.id = sil.dc_line_id
  WHERE si.id = p_reference_document_id
    AND NOT EXISTS (
      SELECT 1 FROM erp_production.reservation_document rd
      WHERE rd.dc_line_id = dcl.id
    );

  IF EXISTS (
    SELECT 1
    FROM erp_procurement.sales_invoice_line sil
    LEFT JOIN erp_production.reservation_document rd ON rd.dc_line_id = sil.dc_line_id
    WHERE sil.invoice_id = p_reference_document_id AND rd.id IS NULL
  ) THEN RAISE EXCEPTION 'VDC_PGI_ONLY_RESERVATION_WRITE_FAILED'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM erp_procurement.sales_invoice
    WHERE dc_id = v_dc_id AND status = 'DRAFT'
  ) THEN
    UPDATE erp_procurement.delivery_challan
    SET status = 'DISPATCHED'
    WHERE id = v_dc_id AND status = 'INVOICED';
    IF NOT FOUND THEN RAISE EXCEPTION 'VDC_PGI_ONLY_DO_NOT_INVOICED'; END IF;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.complete_vdc_pgi_only_action(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.complete_vdc_pgi_only_action(uuid, jsonb, jsonb) TO service_role;

INSERT INTO erp_inventory.posting_source_registry (
  reference_document_type, label, source_schema, source_table,
  status_column, suspect_statuses, is_active, completion_schema, completion_function
) VALUES (
  'VDC_SALES_INVOICE', 'VDC deferred PGI', 'erp_procurement', 'sales_invoice',
  'status', ARRAY['DRAFT'], true, 'erp_procurement', 'complete_vdc_pgi_only_action'
)
ON CONFLICT (reference_document_type) DO UPDATE
SET label = EXCLUDED.label,
    source_schema = EXCLUDED.source_schema,
    source_table = EXCLUDED.source_table,
    status_column = EXCLUDED.status_column,
    suspect_statuses = EXCLUDED.suspect_statuses,
    is_active = EXCLUDED.is_active,
    completion_schema = EXCLUDED.completion_schema,
    completion_function = EXCLUDED.completion_function;
