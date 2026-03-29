/*
 * File-ID: 6.18G
 * File-Path: supabase/migrations/20260410128000_gate6_6_18G_acl_snapshot_ssot_realign.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Realign ACL snapshot generation to SSOT precedence, canonical resource identity, capability inheritance, and module-resource truth
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
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM acl.acl_versions
    WHERE acl_version_id = p_acl_version_id
      AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'ACL_VERSION_NOT_FOUND_OR_COMPANY_MISMATCH';
  END IF;

  DELETE FROM acl.precomputed_acl_view
  WHERE acl_version_id = p_acl_version_id
    AND company_id = p_company_id;

  WITH role_catalog(role_code, role_rank, role_family) AS (
    VALUES
      ('DIRECTOR'::TEXT, 100, 'MANAGER'::TEXT),
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
      arm.resource_code,
      cma.action AS action_code,
      CASE WHEN cma.allowed THEN 'ALLOW' ELSE 'DENY' END AS decision,
      CASE WHEN cma.allowed THEN 'CAPABILITY_ALLOW' ELSE 'CAPABILITY_DENY' END AS decision_reason,
      irs.role_rank AS source_role_rank,
      CASE WHEN cma.allowed THEN 100000 ELSE 100100 END AS precedence_weight
    FROM inherited_role_scope AS irs
    JOIN acl.role_capabilities AS rc
      ON rc.role_code = irs.role_code
    JOIN acl.capability_menu_actions AS cma
      ON cma.capability_code = rc.capability_code
    JOIN acl_menu_resource_map AS arm
      ON arm.menu_id = cma.menu_id
  ),
  role_candidates AS (
    SELECT
      irs.auth_user_id,
      arm.resource_code,
      rmp.action AS action_code,
      rmp.effect AS decision,
      CASE WHEN rmp.effect = 'DENY' THEN 'ROLE_PERMISSION_DENY' ELSE 'ROLE_PERMISSION_ALLOW' END AS decision_reason,
      irs.role_rank AS source_role_rank,
      CASE WHEN rmp.effect = 'DENY' THEN 200100 ELSE 200000 END AS precedence_weight
    FROM inherited_role_scope AS irs
    JOIN acl.role_menu_permissions AS rmp
      ON rmp.role_code = irs.role_code
    JOIN acl_menu_resource_map AS arm
      ON arm.menu_id = rmp.menu_id
  ),
  base_candidates AS (
    SELECT * FROM capability_candidates
    UNION ALL
    SELECT * FROM role_candidates
  ),
  resolved_base AS (
    SELECT
      ranked.auth_user_id,
      ranked.resource_code,
      ranked.action_code,
      ranked.decision,
      ranked.decision_reason
    FROM (
      SELECT
        base_candidates.*,
        ROW_NUMBER() OVER (
          PARTITION BY base_candidates.auth_user_id, base_candidates.resource_code, base_candidates.action_code
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
      uo.user_id AS auth_user_id,
      UPPER(TRIM(uo.resource_code)) AS resource_code,
      UPPER(TRIM(uo.action_code)) AS action_code,
      uo.effect AS decision,
      CASE WHEN uo.effect = 'DENY' THEN 'USER_OVERRIDE_DENY' ELSE 'USER_OVERRIDE_ALLOW' END AS decision_reason,
      CASE WHEN uo.effect = 'DENY' THEN 500100 ELSE 500000 END AS precedence_weight
    FROM acl.user_overrides AS uo
    WHERE uo.company_id = p_company_id
      AND uo.revoked_at IS NULL
  ),
  candidate_actions AS (
    SELECT auth_user_id, resource_code, action_code
    FROM resolved_base

    UNION

    SELECT auth_user_id, resource_code, action_code
    FROM override_candidates
  ),
  module_deny_candidates AS (
    SELECT
      ca.auth_user_id,
      ca.resource_code,
      ca.action_code,
      'DENY'::TEXT AS decision,
      'MODULE_DISABLED'::TEXT AS decision_reason,
      600000 AS precedence_weight
    FROM candidate_actions AS ca
    JOIN acl.module_resource_map AS mrm
      ON mrm.resource_code = ca.resource_code
    LEFT JOIN acl.company_module_map AS cmm
      ON cmm.company_id = p_company_id
     AND cmm.module_code = mrm.module_code
    WHERE COALESCE(cmm.enabled, FALSE) = FALSE
  ),
  final_candidates AS (
    SELECT
      resolved_base.auth_user_id,
      resolved_base.resource_code,
      resolved_base.action_code,
      resolved_base.decision,
      resolved_base.decision_reason,
      1000 AS precedence_weight
    FROM resolved_base

    UNION ALL

    SELECT
      override_candidates.auth_user_id,
      override_candidates.resource_code,
      override_candidates.action_code,
      override_candidates.decision,
      override_candidates.decision_reason,
      override_candidates.precedence_weight
    FROM override_candidates

    UNION ALL

    SELECT
      module_deny_candidates.auth_user_id,
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
        PARTITION BY final_candidates.auth_user_id, final_candidates.resource_code, final_candidates.action_code
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
    resource_code,
    action_code,
    decision,
    decision_reason
  )
  SELECT
    p_acl_version_id,
    final_ranked.auth_user_id,
    p_company_id,
    final_ranked.resource_code,
    final_ranked.action_code,
    final_ranked.decision,
    final_ranked.decision_reason
  FROM final_ranked
  WHERE final_ranked.rn = 1;
END;
$$;

COMMENT ON FUNCTION acl.generate_acl_snapshot(UUID, UUID)
IS 'Generates one deterministic ACL snapshot per active company version using capability inheritance, direct role overrides, exact resource identity, user overrides, and module hard-deny precedence.';

COMMIT;
