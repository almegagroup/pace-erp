BEGIN;

-- Keep the VDC-scoped similarity resolver deterministic even after later
-- CREATE OR REPLACE migrations. It is an internal service-role helper.
ALTER FUNCTION erp_master.find_similar_customer_names_in_vdc(text, uuid, real, integer)
  SET search_path = erp_master, extensions, public;
REVOKE ALL ON FUNCTION erp_master.find_similar_customer_names_in_vdc(text, uuid, real, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_master.find_similar_customer_names_in_vdc(text, uuid, real, integer) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
