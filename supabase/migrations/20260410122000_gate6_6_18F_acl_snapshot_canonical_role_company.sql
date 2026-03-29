/*
 * File-ID: 6.18F
 * File-Path: supabase/migrations/20260410122000_gate6_6_18F_acl_snapshot_canonical_role_company.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Rebind ACL snapshot generation to canonical role and company tables
 * Authority: Backend
 */

BEGIN;

CREATE OR REPLACE FUNCTION acl.generate_acl_snapshot(
    p_acl_version_id uuid,
    p_company_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN

  IF NOT EXISTS (
    SELECT 1
    FROM acl.acl_versions
    WHERE acl_version_id = p_acl_version_id
  ) THEN
    RAISE EXCEPTION 'ACL_VERSION_NOT_FOUND';
  END IF;

  DELETE FROM acl.precomputed_acl_view
  WHERE acl_version_id = p_acl_version_id
    AND company_id = p_company_id;

  INSERT INTO acl.precomputed_acl_view (
      acl_version_id,
      auth_user_id,
      company_id,
      resource_code,
      action_code,
      decision,
      decision_reason
  )
  SELECT
      p_acl_version_id,
      ur.auth_user_id,
      p_company_id,
      mm.menu_code,
      rmp.action,
      rmp.effect,
      'ROLE_PERMISSION'
  FROM acl.role_menu_permissions rmp
  JOIN acl.menu_master mm
        ON mm.id = rmp.menu_id
  JOIN erp_acl.user_roles ur
        ON ur.role_code = rmp.role_code
  JOIN erp_map.user_companies uc
        ON uc.auth_user_id = ur.auth_user_id
       AND uc.company_id = p_company_id;

  UPDATE acl.precomputed_acl_view snap
  SET decision = 'DENY',
      decision_reason = 'MODULE_DISABLED'
  WHERE snap.acl_version_id = p_acl_version_id
    AND snap.company_id = p_company_id
    AND EXISTS (
      SELECT 1
      FROM acl.company_module_map cm
      WHERE cm.company_id = p_company_id
        AND cm.module_code = snap.resource_code
        AND cm.enabled = false
    );

  UPDATE acl.precomputed_acl_view snap
  SET decision = uo.effect,
      decision_reason = 'USER_OVERRIDE'
  FROM acl.user_overrides uo
  WHERE snap.acl_version_id = p_acl_version_id
    AND snap.company_id = p_company_id
    AND snap.auth_user_id = uo.user_id
    AND snap.resource_code = uo.resource_code
    AND snap.action_code = uo.action_code
    AND uo.company_id = p_company_id
    AND uo.revoked_at IS NULL;

END;
$$;

COMMENT ON FUNCTION acl.generate_acl_snapshot(uuid, uuid)
IS 'Generates deterministic ACL snapshot per version + company using canonical erp_acl.user_roles and erp_map.user_companies.';

COMMIT;
