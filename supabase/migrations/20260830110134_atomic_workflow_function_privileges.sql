REVOKE ALL ON FUNCTION erp_procurement.save_delivery_order_unified_atomic(text, uuid, jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.save_delivery_order_unified_atomic(text, uuid, jsonb, jsonb, jsonb, uuid) TO service_role;
REVOKE ALL ON FUNCTION erp_inventory.post_sales_invoice_groups_atomic(jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_inventory.post_sales_invoice_groups_atomic(jsonb, uuid) TO service_role;
REVOKE ALL ON FUNCTION erp_procurement.save_so_map_group_atomic(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.save_so_map_group_atomic(jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION erp_procurement.release_so_map_group_atomic(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.release_so_map_group_atomic(uuid, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
