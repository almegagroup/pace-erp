-- Supabase CLI v2.75.0 incorrectly merges a statement containing an
-- "atomic" identifier with any following statement. Keep this one DO block
-- as the whole migration so the pre-existing Dev functions and newly-created
-- Prod functions receive the same least-privilege grants.
DO $privileges$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION erp_production.create_mts_packing_orders_atomic(jsonb) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION erp_production.create_mts_packing_orders_atomic(jsonb) TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION erp_production.save_mts_material_plan_atomic(uuid, uuid, date, jsonb) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION erp_production.save_mts_material_plan_atomic(uuid, uuid, date, jsonb) TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION erp_production.create_mts_documents_atomic(jsonb) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION erp_production.create_mts_documents_atomic(jsonb) TO service_role';
END;
$privileges$;
