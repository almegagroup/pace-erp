-- Fix anon/authenticated_security_definer_function_executable advisor findings (WARN).
-- Both functions were granted EXECUTE to PUBLIC (which cascades to anon +
-- authenticated via PostgREST), never scoped to service_role explicitly.
-- auto_close_expired_procurement_plans() only runs via pg_cron (as postgres,
-- which already has its own grant). generate_batch_series_number() is only
-- ever called server-side via serviceRoleClient.rpc(...)
-- (batch_series.handlers.ts). Neither needs public/authenticated access.

BEGIN;

REVOKE EXECUTE ON FUNCTION erp_procurement.auto_close_expired_procurement_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.auto_close_expired_procurement_plans() TO service_role;

REVOKE EXECUTE ON FUNCTION erp_production.generate_batch_series_number(uuid, text, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_production.generate_batch_series_number(uuid, text, uuid, date) TO service_role;

COMMIT;
