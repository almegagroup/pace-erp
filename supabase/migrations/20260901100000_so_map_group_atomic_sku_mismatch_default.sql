-- Real bug found live 2026-09-01: erp_procurement.sales_order_map_allocation.
-- sku_mismatch_confirmed is NOT NULL with no default. The TypeScript caller
-- (so_map.handlers.ts) only ever sets it to true for the exempt-mismatch
-- branch; every normal (non-mismatched) line left the key entirely absent,
-- so jsonb_to_recordset() produced a real NULL and every SO Map "save group"
-- with at least one non-mismatched line failed with
-- "null value in column sku_mismatch_confirmed ... violates not-null
-- constraint". Fixed at the call site too (insertPayload now always sends
-- false as a baseline) - this coalesce is the structural backstop so no
-- future/other caller of this RPC can reintroduce the same failure.
CREATE OR REPLACE FUNCTION erp_procurement.save_so_map_group_atomic(p_group jsonb, p_allocations jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'erp_procurement', 'erp_production', 'public'
AS $function$
DECLARE v_group_id uuid;
BEGIN
  INSERT INTO erp_procurement.sales_order_map_group (so_id, fo_id, customer_address_id, depot_code_id, status, created_by)
  VALUES ((p_group->>'so_id')::uuid, nullif(p_group->>'fo_id', '')::uuid, nullif(p_group->>'customer_address_id', '')::uuid, nullif(p_group->>'depot_code_id', '')::uuid, 'ACTIVE', (p_group->>'created_by')::uuid)
  RETURNING id INTO v_group_id;
  INSERT INTO erp_procurement.sales_order_map_allocation (so_id, so_line_id, fo_id, customer_address_id, depot_code_id, plan_feed_item_id, allocated_qty, status, sku_mismatch_confirmed, created_by, map_group_id)
  SELECT so_id, so_line_id, fo_id, customer_address_id, depot_code_id, plan_feed_item_id, allocated_qty, 'ACTIVE', coalesce(sku_mismatch_confirmed, false), created_by, v_group_id
  FROM jsonb_to_recordset(coalesce(p_allocations, '[]'::jsonb)) AS a(so_id uuid, so_line_id uuid, fo_id uuid, customer_address_id uuid, depot_code_id uuid, plan_feed_item_id uuid, allocated_qty numeric, sku_mismatch_confirmed boolean, created_by uuid);
  IF NOT FOUND THEN RAISE EXCEPTION 'SO_MAP_GROUP_EMPTY'; END IF;
  RETURN v_group_id;
END;
$function$;
