/*
 * File-ID: 6.6D
 * File-Path: supabase/migrations/20260410170000_gate6_6_6D_add_l4_manager_role.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Add L4_MANAGER as a canonical manager-tier role between DIRECTOR and L3_MANAGER.
 * Authority: Backend
 */

BEGIN;

CREATE OR REPLACE FUNCTION acl.generate_acl_snapshot(
  p_acl_version_id UUID,
  p_company_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_captured_at TIMESTAMPTZ;
BEGIN
  SELECT source_captured_at
  INTO v_source_captured_at
  FROM acl.acl_versions
  WHERE acl_version_id = p_acl_version_id
    AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACL_VERSION_NOT_FOUND_OR_COMPANY_MISMATCH';
  END IF;

  IF v_source_captured_at IS NULL THEN
    RAISE EXCEPTION 'ACL_VERSION_SOURCE_NOT_CAPTURED';
  END IF;

  DELETE FROM acl.precomputed_acl_view
  WHERE acl_version_id = p_acl_version_id
    AND company_id = p_company_id;

  WITH role_catalog(role_code, role_rank, role_family) AS (
    VALUES
      ('DIRECTOR'::TEXT, 100, 'MANAGER'::TEXT),
      ('L4_MANAGER'::TEXT, 95, 'MANAGER'::TEXT),
      ('L3_MANAGER'::TEXT, 90, 'MANAGER'::TEXT),
      ('L2_AUDITOR'::TEXT, 80, 'AUDITOR'::TEXT),
      ('L1_AUDITOR'::TEXT, 70, 'AUDITOR'::TEXT),
      ('L2_MANAGER'::TEXT, 60, 'MANAGER'::TEXT),
      ('L1_MANAGER'::TEXT, 50, 'MANAGER'::TEXT),
      ('L4_USER'::TEXT, 40, 'USER'::TEXT),
      ('L3_USER'::TEXT, 30, 'USER'::TEXT),
      ('L2_USER'::TEXT, 20, 'USER'::TEXT),
      ('L1_USER'::TEXT, 10, 'USER'::TEXT)
  ),
  role_scope AS (
    SELECT
      ur.auth_user_id,
      ur.role_code AS assigned_role_code,
      COALESCE(ur.role_rank, rc.role_rank) AS assigned_role_rank,
      rc.role_family
    FROM erp_acl.user_roles AS ur
    JOIN erp_map.user_companies AS uc
      ON uc.auth_user_id = ur.auth_user_id
     AND uc.company_id = p_company_id
    LEFT JOIN role_catalog AS rc
      ON rc.role_code = ur.role_code
  ),
  inherited_role_scope AS (
    SELECT DISTINCT
      rs.auth_user_id,
      COALESCE(child.role_code, rs.assigned_role_code) AS role_code,
      COALESCE(child.role_rank, rs.assigned_role_rank, 0) AS role_rank
    FROM role_scope AS rs
    LEFT JOIN role_catalog AS assigned
      ON assigned.role_code = rs.assigned_role_code
    LEFT JOIN role_catalog AS child
      ON (
        assigned.role_family = 'USER'
        AND child.role_family = 'USER'
        AND child.role_rank <= rs.assigned_role_rank
      )
      OR (
        assigned.role_family = 'MANAGER'
        AND child.role_family IN ('USER', 'MANAGER')
        AND child.role_rank <= rs.assigned_role_rank
      )
      OR (
        assigned.role_family = 'AUDITOR'
        AND child.role_family = 'AUDITOR'
        AND child.role_rank <= rs.assigned_role_rank
      )
  ),
  work_context_scope AS (
    SELECT DISTINCT
      uwc.auth_user_id,
      uwc.company_id,
      wc.work_context_id,
      wc.work_context_code,
      wc.department_id
    FROM erp_acl.user_work_contexts AS uwc
    JOIN erp_acl.work_contexts AS wc
      ON wc.work_context_id = uwc.work_context_id
     AND wc.is_active = TRUE
    WHERE uwc.company_id = p_company_id
  ),
  acl_menu_resource_map AS (
    SELECT
      amm.id AS menu_id,
      COALESCE(emr.resource_code, emc.resource_code, amm.menu_code) AS resource_code
    FROM acl.menu_master AS amm
    LEFT JOIN erp_menu.menu_master AS emr
      ON emr.resource_code = amm.menu_code
    LEFT JOIN erp_menu.menu_master AS emc
      ON emc.menu_code = amm.menu_code
  ),
  capability_candidates AS (
    SELECT
      irs.auth_user_id,
      wcs.work_context_id,
      wcs.department_id,
      arm.resource_code,
      vcma.action AS action_code,
      CASE WHEN vcma.allowed THEN 'ALLOW' ELSE 'DENY' END AS decision,
      CASE WHEN vcma.allowed THEN 'CAPABILITY_ALLOW' ELSE 'CAPABILITY_DENY' END AS decision_reason,
      irs.role_rank AS source_role_rank,
      CASE WHEN vcma.allowed THEN 100000 ELSE 100100 END AS precedence_weight
    FROM inherited_role_scope AS irs
    JOIN work_context_scope AS wcs
      ON wcs.auth_user_id = irs.auth_user_id
    JOIN acl.version_role_capabilities AS vrc
      ON vrc.acl_version_id = p_acl_version_id
     AND vrc.role_code = irs.role_code
    JOIN acl.version_work_context_capabilities AS vwcc
      ON vwcc.acl_version_id = p_acl_version_id
     AND vwcc.work_context_id = wcs.work_context_id
     AND vwcc.capability_code = vrc.capability_code
    JOIN acl.version_capability_menu_actions AS vcma
      ON vcma.acl_version_id = p_acl_version_id
     AND vcma.capability_code = vrc.capability_code
    JOIN acl_menu_resource_map AS arm
      ON arm.menu_id = vcma.menu_id
  ),
  role_candidates AS (
    SELECT
      irs.auth_user_id,
      wcs.work_context_id,
      wcs.department_id,
      arm.resource_code,
      vrmp.action AS action_code,
      vrmp.effect AS decision,
      CASE
        WHEN vrmp.effect = 'DENY' THEN 'ROLE_PERMISSION_DENY'
        ELSE 'ROLE_PERMISSION_ALLOW'
      END AS decision_reason,
      irs.role_rank AS source_role_rank,
      CASE WHEN vrmp.effect = 'DENY' THEN 200100 ELSE 200000 END AS precedence_weight
    FROM inherited_role_scope AS irs
    JOIN work_context_scope AS wcs
      ON wcs.auth_user_id = irs.auth_user_id
    JOIN acl.version_role_menu_permissions AS vrmp
      ON vrmp.acl_version_id = p_acl_version_id
     AND vrmp.role_code = irs.role_code
    JOIN acl_menu_resource_map AS arm
      ON arm.menu_id = vrmp.menu_id
  ),
  base_candidates AS (
    SELECT * FROM capability_candidates
    UNION ALL
    SELECT * FROM role_candidates
  ),
  resolved_base AS (
    SELECT
      ranked.auth_user_id,
      ranked.work_context_id,
      ranked.department_id,
      ranked.resource_code,
      ranked.action_code,
      ranked.decision,
      ranked.decision_reason
    FROM (
      SELECT
        base_candidates.*,
        ROW_NUMBER() OVER (
          PARTITION BY
            base_candidates.auth_user_id,
            base_candidates.work_context_id,
            base_candidates.resource_code,
            base_candidates.action_code
          ORDER BY
            base_candidates.precedence_weight DESC,
            base_candidates.source_role_rank DESC,
            CASE WHEN base_candidates.decision = 'DENY' THEN 1 ELSE 0 END DESC
        ) AS rn
      FROM base_candidates
    ) AS ranked
    WHERE ranked.rn = 1
  ),
  override_candidates AS (
    SELECT
      wcs.auth_user_id,
      wcs.work_context_id,
      wcs.department_id,
      UPPER(TRIM(vuo.resource_code)) AS resource_code,
      UPPER(TRIM(vuo.action_code)) AS action_code,
      vuo.effect AS decision,
      CASE
        WHEN vuo.effect = 'DENY' THEN 'USER_OVERRIDE_DENY'
        ELSE 'USER_OVERRIDE_ALLOW'
      END AS decision_reason,
      CASE WHEN vuo.effect = 'DENY' THEN 500100 ELSE 500000 END AS precedence_weight
    FROM acl.version_user_overrides AS vuo
    JOIN work_context_scope AS wcs
      ON wcs.auth_user_id = vuo.user_id
     AND wcs.company_id = vuo.company_id
    WHERE vuo.acl_version_id = p_acl_version_id
      AND vuo.company_id = p_company_id
  ),
  candidate_actions AS (
    SELECT
      auth_user_id,
      work_context_id,
      department_id,
      resource_code,
      action_code
    FROM resolved_base

    UNION

    SELECT
      auth_user_id,
      work_context_id,
      department_id,
      resource_code,
      action_code
    FROM override_candidates
  ),
  module_deny_candidates AS (
    SELECT
      ca.auth_user_id,
      ca.work_context_id,
      ca.department_id,
      ca.resource_code,
      ca.action_code,
      'DENY'::TEXT AS decision,
      'MODULE_DISABLED'::TEXT AS decision_reason,
      600000 AS precedence_weight
    FROM candidate_actions AS ca
    JOIN acl.module_resource_map AS mrm
      ON mrm.resource_code = ca.resource_code
    LEFT JOIN acl.version_company_module_map AS vcmm
      ON vcmm.acl_version_id = p_acl_version_id
     AND vcmm.company_id = p_company_id
     AND vcmm.module_code = mrm.module_code
    WHERE COALESCE(vcmm.enabled, FALSE) = FALSE
  ),
  final_candidates AS (
    SELECT
      resolved_base.auth_user_id,
      resolved_base.work_context_id,
      resolved_base.department_id,
      resolved_base.resource_code,
      resolved_base.action_code,
      resolved_base.decision,
      resolved_base.decision_reason,
      1000 AS precedence_weight
    FROM resolved_base

    UNION ALL

    SELECT
      override_candidates.auth_user_id,
      override_candidates.work_context_id,
      override_candidates.department_id,
      override_candidates.resource_code,
      override_candidates.action_code,
      override_candidates.decision,
      override_candidates.decision_reason,
      override_candidates.precedence_weight
    FROM override_candidates

    UNION ALL

    SELECT
      module_deny_candidates.auth_user_id,
      module_deny_candidates.work_context_id,
      module_deny_candidates.department_id,
      module_deny_candidates.resource_code,
      module_deny_candidates.action_code,
      module_deny_candidates.decision,
      module_deny_candidates.decision_reason,
      module_deny_candidates.precedence_weight
    FROM module_deny_candidates
  ),
  final_ranked AS (
    SELECT
      final_candidates.*,
      ROW_NUMBER() OVER (
        PARTITION BY
          final_candidates.auth_user_id,
          final_candidates.work_context_id,
          final_candidates.resource_code,
          final_candidates.action_code
        ORDER BY
          final_candidates.precedence_weight DESC,
          CASE WHEN final_candidates.decision = 'DENY' THEN 1 ELSE 0 END DESC
      ) AS rn
    FROM final_candidates
  )
  INSERT INTO acl.precomputed_acl_view (
    acl_version_id,
    auth_user_id,
    company_id,
    work_context_id,
    project_id,
    department_id,
    resource_code,
    action_code,
    decision,
    decision_reason
  )
  SELECT
    p_acl_version_id,
    final_ranked.auth_user_id,
    p_company_id,
    final_ranked.work_context_id,
    NULL,
    final_ranked.department_id,
    final_ranked.resource_code,
    final_ranked.action_code,
    final_ranked.decision,
    final_ranked.decision_reason
  FROM final_ranked
  WHERE final_ranked.rn = 1;
END;
$$;

COMMENT ON FUNCTION acl.generate_acl_snapshot(UUID, UUID) IS
'Generates one immutable-company ACL snapshot per frozen ACL version, selected work context, enabled modules, and explicit overrides.';

COMMIT;
