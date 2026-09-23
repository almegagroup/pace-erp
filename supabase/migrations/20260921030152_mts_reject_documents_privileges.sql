DO $privileges$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION erp_production.reject_mts_documents_atomic(uuid, uuid, text) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION erp_production.reject_mts_documents_atomic(uuid, uuid, text) TO service_role';
END;
$privileges$;
