-- SO01/SO02/SO03 atomic persistence. Every function below deliberately lets
-- exceptions escape: PostgreSQL then rolls the complete request back.
BEGIN;

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
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION erp_procurement.save_delivery_order_unified_atomic(text, uuid, jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.save_delivery_order_unified_atomic(text, uuid, jsonb, jsonb, jsonb, uuid) TO service_role;

CREATE OR REPLACE FUNCTION erp_inventory.post_sales_invoice_groups_atomic(
  p_groups jsonb,
  p_posted_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_inventory, erp_procurement, public
AS $function$
DECLARE
  v_group jsonb;
BEGIN
  IF p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array' OR jsonb_array_length(p_groups) = 0 THEN
    RAISE EXCEPTION 'PGI_INVOICE_GROUPS_INVALID';
  END IF;
  FOR v_group IN SELECT value FROM jsonb_array_elements(p_groups)
  LOOP
    PERFORM erp_inventory.post_document(
      'SALES_INVOICE', (v_group->>'invoice_id')::uuid, v_group->'movements', p_posted_by, v_group->'context'
    );
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION erp_inventory.post_sales_invoice_groups_atomic(jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_inventory.post_sales_invoice_groups_atomic(jsonb, uuid) TO service_role;

CREATE OR REPLACE FUNCTION erp_procurement.save_so_map_group_atomic(
  p_group jsonb,
  p_allocations jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $function$
DECLARE
  v_group_id uuid;
BEGIN
  INSERT INTO erp_procurement.sales_order_map_group (
    so_id, fo_id, customer_address_id, depot_code_id, status, created_by
  ) VALUES (
    (p_group->>'so_id')::uuid, nullif(p_group->>'fo_id', '')::uuid,
    nullif(p_group->>'customer_address_id', '')::uuid, nullif(p_group->>'depot_code_id', '')::uuid,
    'ACTIVE', (p_group->>'created_by')::uuid
  ) RETURNING id INTO v_group_id;

  INSERT INTO erp_procurement.sales_order_map_allocation (
    so_id, so_line_id, fo_id, customer_address_id, depot_code_id,
    plan_feed_item_id, allocated_qty, status, sku_mismatch_confirmed,
    created_by, map_group_id
  )
  SELECT so_id, so_line_id, fo_id, customer_address_id, depot_code_id,
    plan_feed_item_id, allocated_qty, 'ACTIVE', sku_mismatch_confirmed,
    created_by, v_group_id
  FROM jsonb_to_recordset(coalesce(p_allocations, '[]'::jsonb)) AS a(
    so_id uuid, so_line_id uuid, fo_id uuid, customer_address_id uuid, depot_code_id uuid,
    plan_feed_item_id uuid, allocated_qty numeric, sku_mismatch_confirmed boolean, created_by uuid
  );
  IF NOT FOUND THEN RAISE EXCEPTION 'SO_MAP_GROUP_EMPTY'; END IF;

  RETURN v_group_id;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.save_so_map_group_atomic(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.save_so_map_group_atomic(jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION erp_procurement.release_so_map_group_atomic(
  p_group_id uuid,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, public
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM erp_procurement.delivery_challan_line line
    JOIN erp_procurement.sales_order_map_allocation allocation ON allocation.id = line.so_map_allocation_id
    WHERE allocation.map_group_id = p_group_id
  ) THEN
    RAISE EXCEPTION 'SO_MAP_DO_LOCKED';
  END IF;
  UPDATE erp_procurement.sales_order_map_allocation
  SET status = 'RELEASED', last_updated_by = p_actor, last_updated_at = now()
  WHERE map_group_id = p_group_id AND status = 'ACTIVE';
  UPDATE erp_procurement.sales_order_map_group
  SET status = 'RELEASED', last_updated_by = p_actor, last_updated_at = now()
  WHERE id = p_group_id AND status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'SO_MAP_GROUP_NOT_FOUND'; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.release_so_map_group_atomic(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.release_so_map_group_atomic(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
