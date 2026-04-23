/*
 * File-ID: 10.3
 * File-Path: supabase/migrations/20260424103000_gate10_3_acl_version_event_advisor_hardening.sql
 * Gate: 10
 * Phase: 10
 * Domain: SECURITY
 * Purpose: Resolve Security Advisor findings for ACL version change event logging table and helper functions.
 * Authority: Backend
 *
 * Notes:
 * - `acl.version_change_events` is read by backend service-role flows only.
 * - RLS is enabled so exposed-schema access is denied by default for client roles.
 * - Service role keeps explicit full access for operational handlers.
 */

BEGIN;

ALTER TABLE IF EXISTS acl.version_change_events
  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS version_change_events_service_role_all
ON acl.version_change_events;

CREATE POLICY version_change_events_service_role_all
ON acl.version_change_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DO $$
BEGIN
  EXECUTE 'ALTER FUNCTION acl.append_version_change_event(uuid, text, text, text, text) SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION acl.log_global_version_change_event() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION acl.log_company_version_change_event() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION acl.log_work_context_version_change_event() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION acl.log_user_role_version_change_event() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
END
$$;

COMMIT;
