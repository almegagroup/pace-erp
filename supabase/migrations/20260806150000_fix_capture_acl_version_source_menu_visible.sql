-- Bug found 2026-08-06 while wiring Group 4's dependency companion capabilities:
-- capture_acl_version_source() never copied menu_visible into
-- acl.version_capability_menu_actions -- the INSERT only selected
-- capability_code, menu_id, action, allowed. Since version_capability_menu_actions.
-- menu_visible defaults to TRUE (NOT NULL), every version bump silently reset every
-- hidden companion capability (menu_visible=false) back to visible in the captured
-- version, defeating the entire menu_visible mechanism (Step 2, built earlier this
-- project) for any capability re-captured after this bug was introduced.
--
-- Fix: copy menu_visible through like every other column.

CREATE OR REPLACE FUNCTION acl.capture_acl_version_source(p_acl_version_id uuid, p_company_id uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'acl', 'erp_acl', 'erp_audit', 'erp_cache', 'erp_core', 'erp_hr', 'erp_map', 'erp_master', 'erp_menu', 'erp_meta'
AS $function$
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
    RAISE NOTICE 'capture_acl_version_source: acl_version_id % already captured at % — this call is a NO-OP, no live data was copied. If you made new ACL data changes (capabilities, grants, work_context_capabilities, etc.) and need them reflected, create a NEW acl.acl_versions row for this company and call capture_acl_version_source on THAT new version_id instead. Re-capturing the same version_id never picks up new live data.', p_acl_version_id, v_source_captured_at;
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
    allowed,
    menu_visible
  )
  SELECT
    p_acl_version_id,
    capability_code,
    menu_id,
    action,
    allowed,
    menu_visible
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
$function$
;
