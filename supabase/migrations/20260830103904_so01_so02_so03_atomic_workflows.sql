-- SO03 atomic persistence. Exceptions deliberately escape so PostgreSQL
-- rolls the complete create/edit operation back.

CREATE OR REPLACE FUNCTION erp_procurement.save_delivery_order_unified_atomic(
  p_action text,
  p_dc_id uuid,
  p_header jsonb,
  p_sources jsonb,
  p_lines jsonb,
  p_actor uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $fn$
DECLARE
  v_dc_id uuid := p_dc_id;
  v_line jsonb;
BEGIN
  IF upper(p_action) = 'CREATE' THEN
    INSERT INTO erp_procurement.delivery_challan (
      dc_number, dc_date, dc_type, selling_company_id, vehicle_number,
      transporter_id, transporter_name_freetext, lr_number, lr_date,
      gross_weight, net_weight, driver_number, driver_contact_number, status, remarks
    ) VALUES (
      p_header->>'dc_number', (p_header->>'dc_date')::date, p_header->>'dc_type',
      (p_header->>'selling_company_id')::uuid, nullif(p_header->>'vehicle_number', '')::text,
      nullif(p_header->>'transporter_id', '')::uuid, nullif(p_header->>'transporter_name_freetext', ''),
      nullif(p_header->>'lr_number', ''), nullif(p_header->>'lr_date', '')::date,
      nullif(p_header->>'gross_weight', '')::numeric, (p_header->>'net_weight')::numeric,
      nullif(p_header->>'driver_number', ''), nullif(p_header->>'driver_contact_number', ''),
      'CREATED', nullif(p_header->>'remarks', '')
    ) RETURNING id INTO v_dc_id;
  ELSIF upper(p_action) = 'UPDATE' THEN
    IF v_dc_id IS NULL THEN RAISE EXCEPTION 'DO_ID_REQUIRED'; END IF;

    UPDATE erp_production.reservation_document
    SET status = 'CANCELLED', dc_line_id = NULL, last_updated_by = p_actor, last_updated_at = now()
    WHERE dc_line_id IN (SELECT id FROM erp_procurement.delivery_challan_line WHERE dc_id = v_dc_id);
    DELETE FROM erp_procurement.delivery_challan_line WHERE dc_id = v_dc_id;
    DELETE FROM erp_procurement.delivery_challan_source WHERE dc_id = v_dc_id;

    UPDATE erp_procurement.delivery_challan SET
      dc_type = p_header->>'dc_type', vehicle_number = nullif(p_header->>'vehicle_number', ''),
      transporter_id = nullif(p_header->>'transporter_id', '')::uuid,
      transporter_name_freetext = nullif(p_header->>'transporter_name_freetext', ''),
      lr_number = nullif(p_header->>'lr_number', ''), lr_date = nullif(p_header->>'lr_date', '')::date,
      gross_weight = nullif(p_header->>'gross_weight', '')::numeric,
      net_weight = (p_header->>'net_weight')::numeric,
      driver_number = nullif(p_header->>'driver_number', ''),
      driver_contact_number = nullif(p_header->>'driver_contact_number', ''),
      remarks = nullif(p_header->>'remarks', '')
    WHERE id = v_dc_id AND status = 'CREATED';
    IF NOT FOUND THEN RAISE EXCEPTION 'DO_EDIT_BLOCKED'; END IF;
  ELSE
    RAISE EXCEPTION 'DO_ACTION_INVALID';
  END IF;

  INSERT INTO erp_procurement.delivery_challan_source (dc_id, source_type, source_id)
  SELECT v_dc_id, source_type, source_id
  FROM jsonb_to_recordset(coalesce(p_sources, '[]'::jsonb)) AS s(source_type text, source_id uuid);

  FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  LOOP
    INSERT INTO erp_procurement.delivery_challan_line (
      dc_id, line_number, material_id, so_line_id, sto_line_id, so_map_allocation_id,
      quantity, uom_code, storage_location_id, batch_number, expiry_date, packing_order_id,
      unit_value, gst_rate, gst_amount, line_total, ship_to_customer_id, ship_to_name,
      ship_to_address, ship_to_state, ship_to_gst_number
    ) VALUES (
      v_dc_id, (v_line->>'line_number')::int, (v_line->>'material_id')::uuid,
      nullif(v_line->>'so_line_id', '')::uuid, nullif(v_line->>'sto_line_id', '')::uuid,
      nullif(v_line->>'so_map_allocation_id', '')::uuid, (v_line->>'quantity')::numeric,
      v_line->>'uom_code', (v_line->>'storage_location_id')::uuid, nullif(v_line->>'batch_number', ''),
      nullif(v_line->>'expiry_date', '')::date, nullif(v_line->>'packing_order_id', '')::uuid,
      (v_line->>'unit_value')::numeric, (v_line->>'gst_rate')::numeric, (v_line->>'gst_amount')::numeric,
      (v_line->>'line_total')::numeric, nullif(v_line->>'ship_to_customer_id', '')::uuid,
      nullif(v_line->>'ship_to_name', ''), nullif(v_line->>'ship_to_address', ''),
      nullif(v_line->>'ship_to_state', ''), nullif(v_line->>'ship_to_gst_number', '')
    );

    INSERT INTO erp_production.reservation_document (
      dc_line_id, source_type, source_id, source_line_id, company_id, material_id,
      storage_location_id, required_qty, uom_code, issued_qty, status,
      created_by, created_at, last_updated_by, last_updated_at
    ) SELECT id, v_line->>'source_type', (v_line->>'source_id')::uuid,
      coalesce(nullif(v_line->>'so_line_id', '')::uuid, nullif(v_line->>'sto_line_id', '')::uuid),
      (p_header->>'selling_company_id')::uuid, (v_line->>'material_id')::uuid,
      (v_line->>'storage_location_id')::uuid, (v_line->>'quantity')::numeric,
      v_line->>'uom_code', 0, 'OPEN', p_actor, now(), p_actor, now()
    FROM erp_procurement.delivery_challan_line
    WHERE dc_id = v_dc_id AND line_number = (v_line->>'line_number')::int;
  END LOOP;

  RETURN v_dc_id;
END;
$fn$;
