/*
 * File-ID: 10.1
 * File-Path: supabase/migrations/20260410144000_gate10_1_advisor_security_hardening.sql
 * Gate: 10
 * Phase: 10
 * Domain: SECURITY
 * Purpose: Resolve Supabase advisor findings for mutable function search_path and exposed/public RLS gaps.
 * Authority: Backend
 *
 * Notes:
 * - Historical migrations remain untouched. This is an append-only hardening patch.
 * - service_role policies preserve backend authority while keeping client roles denied by default.
 */

BEGIN;

DO $$
BEGIN
  EXECUTE 'ALTER FUNCTION erp_meta.next_user_code_p_seq() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_meta.approve_signup_atomic(uuid, uuid) SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_meta.reject_signup_atomic(uuid, uuid) SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_meta.req_header(text) SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_meta.req_company_id() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_meta.req_project_id() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_meta.req_department_id() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_meta.req_is_admin() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_master.generate_company_code() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_master.block_company_delete() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_core.enforce_session_cluster_window_admission() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_master.assert_company_active(uuid) SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_master.generate_project_code() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_master.generate_department_code() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_map.assert_project_belongs_to_company(uuid, uuid) SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_map.assert_user_project_subset(uuid, uuid) SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_map.assert_department_scope(uuid, uuid) SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_menu.prevent_system_menu_disable() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_map.get_primary_company(uuid) SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION acl.capture_acl_version_source(uuid, uuid, uuid) SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION acl.enforce_approver_scope_integrity() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_menu.generate_menu_snapshot(uuid, uuid, uuid, text) SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_menu.enforce_same_universe() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_menu.prevent_menu_cycles() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_master.prevent_company_code_update() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_master.assert_company_delete_safe() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_master.generate_group_code() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_master.prevent_group_code_update() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION erp_master.assert_group_delete_safe() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION acl.enforce_module_project_integrity() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION acl.enforce_workflow_state_machine() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION acl.process_workflow_decision_atomic(uuid, uuid, integer, text) SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION acl.generate_acl_snapshot(uuid, uuid) SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION acl.enforce_director_invariant() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION acl.enforce_approver_bounds() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
  EXECUTE 'ALTER FUNCTION acl.enforce_report_viewer_scope_integrity() SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta';
END
$$;

ALTER TABLE IF EXISTS acl.work_context_capabilities
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.version_role_menu_permissions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.version_role_capabilities
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.version_capability_menu_actions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.version_user_overrides
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.version_company_module_map
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.version_work_context_capabilities
  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_action_audit_service_role_all
ON erp_audit.admin_action_audit;

CREATE POLICY admin_action_audit_service_role_all
ON erp_audit.admin_action_audit
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS signup_approvals_service_role_all
ON erp_audit.signup_approvals;

CREATE POLICY signup_approvals_service_role_all
ON erp_audit.signup_approvals
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS gst_profiles_service_role_all
ON erp_cache.gst_profiles;

CREATE POLICY gst_profiles_service_role_all
ON erp_cache.gst_profiles
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS session_menu_snapshot_service_role_all
ON erp_cache.session_menu_snapshot;

CREATE POLICY session_menu_snapshot_service_role_all
ON erp_cache.session_menu_snapshot
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS session_cluster_join_tickets_service_role_all
ON erp_core.session_cluster_join_tickets;

CREATE POLICY session_cluster_join_tickets_service_role_all
ON erp_core.session_cluster_join_tickets
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS session_cluster_windows_service_role_all
ON erp_core.session_cluster_windows;

CREATE POLICY session_cluster_windows_service_role_all
ON erp_core.session_cluster_windows
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS session_clusters_service_role_all
ON erp_core.session_clusters;

CREATE POLICY session_clusters_service_role_all
ON erp_core.session_clusters
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS work_context_capabilities_service_role_all
ON acl.work_context_capabilities;

CREATE POLICY work_context_capabilities_service_role_all
ON acl.work_context_capabilities
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS version_role_menu_permissions_service_role_all
ON acl.version_role_menu_permissions;

CREATE POLICY version_role_menu_permissions_service_role_all
ON acl.version_role_menu_permissions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS version_role_capabilities_service_role_all
ON acl.version_role_capabilities;

CREATE POLICY version_role_capabilities_service_role_all
ON acl.version_role_capabilities
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS version_capability_menu_actions_service_role_all
ON acl.version_capability_menu_actions;

CREATE POLICY version_capability_menu_actions_service_role_all
ON acl.version_capability_menu_actions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS version_user_overrides_service_role_all
ON acl.version_user_overrides;

CREATE POLICY version_user_overrides_service_role_all
ON acl.version_user_overrides
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS version_company_module_map_service_role_all
ON acl.version_company_module_map;

CREATE POLICY version_company_module_map_service_role_all
ON acl.version_company_module_map
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS version_work_context_capabilities_service_role_all
ON acl.version_work_context_capabilities;

CREATE POLICY version_work_context_capabilities_service_role_all
ON acl.version_work_context_capabilities
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMIT;
