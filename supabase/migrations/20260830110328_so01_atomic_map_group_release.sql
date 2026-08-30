CREATE OR REPLACE FUNCTION erp_procurement.release_so_map_group_atomic(p_group_id uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = erp_procurement, public
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM erp_procurement.delivery_challan_line line JOIN erp_procurement.sales_order_map_allocation allocation ON allocation.id = line.so_map_allocation_id WHERE allocation.map_group_id = p_group_id) THEN
    RAISE EXCEPTION 'SO_MAP_DO_LOCKED';
  END IF;
  UPDATE erp_procurement.sales_order_map_allocation SET status = 'RELEASED', last_updated_by = p_actor, last_updated_at = now() WHERE map_group_id = p_group_id AND status = 'ACTIVE';
  UPDATE erp_procurement.sales_order_map_group SET status = 'RELEASED', last_updated_by = p_actor, last_updated_at = now() WHERE id = p_group_id AND status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'SO_MAP_GROUP_NOT_FOUND'; END IF;
END;
$fn$;
