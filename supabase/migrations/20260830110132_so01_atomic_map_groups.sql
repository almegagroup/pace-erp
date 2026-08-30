CREATE OR REPLACE FUNCTION erp_procurement.save_so_map_group_atomic(p_group jsonb, p_allocations jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
AS $fn$
DECLARE v_group_id uuid;
BEGIN
  INSERT INTO erp_procurement.sales_order_map_group (so_id, fo_id, customer_address_id, depot_code_id, status, created_by)
  VALUES ((p_group->>'so_id')::uuid, nullif(p_group->>'fo_id', '')::uuid, nullif(p_group->>'customer_address_id', '')::uuid, nullif(p_group->>'depot_code_id', '')::uuid, 'ACTIVE', (p_group->>'created_by')::uuid)
  RETURNING id INTO v_group_id;
  INSERT INTO erp_procurement.sales_order_map_allocation (so_id, so_line_id, fo_id, customer_address_id, depot_code_id, plan_feed_item_id, allocated_qty, status, sku_mismatch_confirmed, created_by, map_group_id)
  SELECT so_id, so_line_id, fo_id, customer_address_id, depot_code_id, plan_feed_item_id, allocated_qty, 'ACTIVE', sku_mismatch_confirmed, created_by, v_group_id
  FROM jsonb_to_recordset(coalesce(p_allocations, '[]'::jsonb)) AS a(so_id uuid, so_line_id uuid, fo_id uuid, customer_address_id uuid, depot_code_id uuid, plan_feed_item_id uuid, allocated_qty numeric, sku_mismatch_confirmed boolean, created_by uuid);
  IF NOT FOUND THEN RAISE EXCEPTION 'SO_MAP_GROUP_EMPTY'; END IF;
  RETURN v_group_id;
END;
$fn$;
