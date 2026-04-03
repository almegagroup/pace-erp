/*
 * File-ID: 6.18I
 * File-Path: supabase/migrations/20260403153000_gate6_6_18I_fix_user_override_reason_capture.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Fix ACL version source capture to read legacy user_overrides.reason into version_user_overrides.override_reason
 * Authority: Backend
 */

BEGIN;

CREATE OR REPLACE FUNCTION acl.capture_acl_version_source(
  p_acl_version_id UUID,
  p_company_id UUID,
  p_actor UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_company_id UUID;
  v_source_captured_at TIMESTAMPTZ;
BEGIN
  SELECT company_id, source_captured_at
  INTO v_company_id, v_source_captured_at
  FROM acl.acl_versions
  WHERE acl_version_id = p_acl_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACL_VERSION_NOT_FOUND';
  END IF;

  IF v_company_id <> p_company_id THEN
    RAISE EXCEPTION 'ACL_VERSION_NOT_FOUND_OR_COMPANY_MISMATCH';
  END IF;

  IF v_source_captured_at IS NOT NULL THEN
    RETURN;
  END IF;

  INSERT INTO acl.version_role_menu_permissions (
    acl_version_id,
    role_code,
    menu_id,
    action,
    effect,
    approval_required
  )
  SELECT
    p_acl_version_id,
    role_code,
    menu_id,
    action,
    effect,
    approval_required
  FROM acl.role_menu_permissions;

  INSERT INTO acl.version_role_capabilities (
    acl_version_id,
    role_code,
    capability_code
  )
  SELECT
    p_acl_version_id,
    role_code,
    capability_code
  FROM acl.role_capabilities;

  INSERT INTO acl.version_capability_menu_actions (
    acl_version_id,
    capability_code,
    menu_id,
    action,
    allowed
  )
  SELECT
    p_acl_version_id,
    capability_code,
    menu_id,
    action,
    allowed
  FROM acl.capability_menu_actions;

  INSERT INTO acl.version_user_overrides (
    acl_version_id,
    user_id,
    company_id,
    resource_code,
    action_code,
    effect,
    override_reason
  )
  SELECT
    p_acl_version_id,
    user_id,
    company_id,
    resource_code,
    action_code,
    effect,
    reason
  FROM acl.user_overrides
  WHERE company_id = p_company_id
    AND revoked_at IS NULL;

  INSERT INTO acl.version_company_module_map (
    acl_version_id,
    company_id,
    module_code,
    enabled
  )
  SELECT
    p_acl_version_id,
    company_id,
    module_code,
    enabled
  FROM acl.company_module_map
  WHERE company_id = p_company_id;

  INSERT INTO acl.version_work_context_capabilities (
    acl_version_id,
    work_context_id,
    capability_code
  )
  SELECT
    p_acl_version_id,
    wcc.work_context_id,
    wcc.capability_code
  FROM acl.work_context_capabilities AS wcc
  JOIN erp_acl.work_contexts AS wc
    ON wc.work_context_id = wcc.work_context_id
  WHERE wc.company_id = p_company_id;

  UPDATE acl.acl_versions
  SET
    source_captured_at = now(),
    source_captured_by = COALESCE(p_actor, source_captured_by, created_by)
  WHERE acl_version_id = p_acl_version_id;
END;
$$;

COMMENT ON FUNCTION acl.capture_acl_version_source(UUID, UUID, UUID) IS
'Freezes the mutable ACL governance tables into immutable version source tables for one company ACL version.';

COMMIT;
