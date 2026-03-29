/*
 * File-ID: 6.18H
 * File-Path: supabase/migrations/20260410130000_gate6_6_18H_acl_version_source_freeze_and_work_context_projection.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Freeze ACL version source tables and make runtime/menu projection work-context-aware
 * Authority: Backend
 */

BEGIN;

ALTER TABLE acl.acl_versions
  ADD COLUMN IF NOT EXISTS source_captured_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS source_captured_by UUID NULL
    REFERENCES erp_core.users(auth_user_id)
    ON DELETE SET NULL;

COMMENT ON COLUMN acl.acl_versions.source_captured_at IS
'Timestamp when live ACL governance tables were frozen into immutable version source tables.';

COMMENT ON COLUMN acl.acl_versions.source_captured_by IS
'Actor who froze live ACL governance tables into immutable version source tables.';

CREATE TABLE IF NOT EXISTS acl.version_role_menu_permissions (
  acl_version_id     UUID NOT NULL
    REFERENCES acl.acl_versions(acl_version_id)
    ON DELETE CASCADE,
  role_code          TEXT NOT NULL,
  menu_id            UUID NOT NULL
    REFERENCES acl.menu_master(id)
    ON DELETE CASCADE,
  action             TEXT NOT NULL,
  effect             TEXT NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
  approval_required  BOOLEAN NOT NULL DEFAULT FALSE,
  captured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_version_role_menu_permissions
    PRIMARY KEY (acl_version_id, role_code, menu_id, action)
);

CREATE TABLE IF NOT EXISTS acl.version_role_capabilities (
  acl_version_id     UUID NOT NULL
    REFERENCES acl.acl_versions(acl_version_id)
    ON DELETE CASCADE,
  role_code          TEXT NOT NULL,
  capability_code    TEXT NOT NULL
    REFERENCES acl.capabilities(capability_code)
    ON DELETE CASCADE,
  captured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_version_role_capabilities
    PRIMARY KEY (acl_version_id, role_code, capability_code)
);

CREATE TABLE IF NOT EXISTS acl.version_capability_menu_actions (
  acl_version_id     UUID NOT NULL
    REFERENCES acl.acl_versions(acl_version_id)
    ON DELETE CASCADE,
  capability_code    TEXT NOT NULL
    REFERENCES acl.capabilities(capability_code)
    ON DELETE CASCADE,
  menu_id            UUID NOT NULL
    REFERENCES acl.menu_master(id)
    ON DELETE CASCADE,
  action             TEXT NOT NULL,
  allowed            BOOLEAN NOT NULL,
  captured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_version_capability_menu_actions
    PRIMARY KEY (acl_version_id, capability_code, menu_id, action)
);

CREATE TABLE IF NOT EXISTS acl.version_user_overrides (
  acl_version_id     UUID NOT NULL
    REFERENCES acl.acl_versions(acl_version_id)
    ON DELETE CASCADE,
  user_id            UUID NOT NULL,
  company_id         UUID NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE CASCADE,
  resource_code      TEXT NOT NULL,
  action_code        TEXT NOT NULL,
  effect             TEXT NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
  override_reason    TEXT NULL,
  captured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_version_user_overrides
    PRIMARY KEY (acl_version_id, user_id, company_id, resource_code, action_code)
);

CREATE TABLE IF NOT EXISTS acl.version_company_module_map (
  acl_version_id     UUID NOT NULL
    REFERENCES acl.acl_versions(acl_version_id)
    ON DELETE CASCADE,
  company_id         UUID NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE CASCADE,
  module_code        TEXT NOT NULL,
  enabled            BOOLEAN NOT NULL,
  captured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_version_company_module_map
    PRIMARY KEY (acl_version_id, company_id, module_code)
);

CREATE TABLE IF NOT EXISTS acl.version_work_context_capabilities (
  acl_version_id     UUID NOT NULL
    REFERENCES acl.acl_versions(acl_version_id)
    ON DELETE CASCADE,
  work_context_id    UUID NOT NULL
    REFERENCES erp_acl.work_contexts(work_context_id)
    ON DELETE CASCADE,
  capability_code    TEXT NOT NULL
    REFERENCES acl.capabilities(capability_code)
    ON DELETE CASCADE,
  captured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_version_work_context_capabilities
    PRIMARY KEY (acl_version_id, work_context_id, capability_code)
);

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
    override_reason
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

DROP FUNCTION IF EXISTS erp_menu.generate_menu_snapshot(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION erp_menu.generate_menu_snapshot(
  p_user_id UUID,
  p_company_id UUID,
  p_work_context_id UUID,
  p_universe TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_next_version INT;
BEGIN
  IF p_universe NOT IN ('SA', 'ACL') THEN
    RAISE EXCEPTION 'Invalid universe: %', p_universe;
  END IF;

  IF p_universe = 'ACL' AND (p_company_id IS NULL OR p_work_context_id IS NULL) THEN
    RAISE EXCEPTION 'ACL snapshot requires company_id and work_context_id';
  END IF;

  IF p_universe = 'SA' THEN
    SELECT COALESCE(MAX(snapshot_version), 0) + 1
    INTO v_next_version
    FROM erp_menu.menu_snapshot
    WHERE user_id = p_user_id
      AND universe = 'SA'
      AND company_id IS NULL
      AND work_context_id IS NULL;

    DELETE FROM erp_menu.menu_snapshot
    WHERE user_id = p_user_id
      AND universe = 'SA'
      AND company_id IS NULL
      AND work_context_id IS NULL;

    INSERT INTO erp_menu.menu_snapshot (
      user_id,
      company_id,
      work_context_id,
      universe,
      snapshot_version,
      menu_code,
      resource_code,
      route_path,
      menu_type,
      parent_menu_code,
      display_order,
      is_visible,
      title,
      description,
      created_at
    )
    SELECT
      p_user_id,
      NULL,
      NULL,
      'SA',
      v_next_version,
      m.menu_code,
      m.resource_code,
      m.route_path,
      m.menu_type,
      pm.menu_code,
      COALESCE(mt.display_order, m.display_order),
      TRUE,
      m.title,
      m.description,
      now()
    FROM erp_menu.menu_master AS m
    LEFT JOIN erp_menu.menu_tree AS mt
      ON mt.child_menu_id = m.id
    LEFT JOIN erp_menu.menu_master AS pm
      ON pm.id = mt.parent_menu_id
    WHERE m.universe = 'SA'
      AND m.is_active = TRUE;

    RETURN;
  END IF;

  SELECT COALESCE(MAX(snapshot_version), 0) + 1
  INTO v_next_version
  FROM erp_menu.menu_snapshot
  WHERE user_id = p_user_id
    AND company_id = p_company_id
    AND work_context_id = p_work_context_id
    AND universe = 'ACL';

  DELETE FROM erp_menu.menu_snapshot
  WHERE user_id = p_user_id
    AND company_id = p_company_id
    AND work_context_id = p_work_context_id
    AND universe = 'ACL';

  WITH RECURSIVE allowed_acl_menus AS (
    SELECT DISTINCT m.id AS menu_id
    FROM acl.precomputed_acl_view AS pav
    JOIN erp_menu.menu_master AS m
      ON m.resource_code = pav.resource_code
    WHERE pav.auth_user_id = p_user_id
      AND pav.company_id = p_company_id
      AND pav.work_context_id = p_work_context_id
      AND pav.decision = 'ALLOW'
      AND pav.action_code = 'VIEW'
      AND m.universe = 'ACL'
      AND m.is_active = TRUE
  ),
  ancestor_chain AS (
    SELECT menu_id
    FROM allowed_acl_menus

    UNION

    SELECT mt.parent_menu_id
    FROM erp_menu.menu_tree AS mt
    JOIN ancestor_chain AS ac
      ON ac.menu_id = mt.child_menu_id
    WHERE mt.parent_menu_id IS NOT NULL
  ),
  projected_acl_menus AS (
    SELECT DISTINCT menu_id
    FROM ancestor_chain
  )
  INSERT INTO erp_menu.menu_snapshot (
    user_id,
    company_id,
    work_context_id,
    universe,
    snapshot_version,
    menu_code,
    resource_code,
    route_path,
    menu_type,
    parent_menu_code,
    display_order,
    is_visible,
    title,
    description,
    created_at
  )
  SELECT
    p_user_id,
    p_company_id,
    p_work_context_id,
    'ACL',
    v_next_version,
    m.menu_code,
    m.resource_code,
    m.route_path,
    m.menu_type,
    pm.menu_code,
    COALESCE(mt.display_order, m.display_order),
    TRUE,
    m.title,
    m.description,
    now()
  FROM projected_acl_menus AS projected
  JOIN erp_menu.menu_master AS m
    ON m.id = projected.menu_id
  LEFT JOIN erp_menu.menu_tree AS mt
    ON mt.child_menu_id = m.id
  LEFT JOIN erp_menu.menu_master AS pm
    ON pm.id = mt.parent_menu_id
  WHERE m.universe = 'ACL'
    AND m.is_active = TRUE
  ORDER BY COALESCE(mt.display_order, m.display_order), m.menu_code;
END;
$$;

COMMENT ON FUNCTION erp_menu.generate_menu_snapshot(UUID, UUID, UUID, TEXT) IS
'Builds menu_snapshot from full SA registry or ACL precomputed_acl_view, keyed by selected work company and selected work context.';

CREATE INDEX IF NOT EXISTS idx_acl_precomputed_enforcement_lookup
ON acl.precomputed_acl_view (
  acl_version_id,
  auth_user_id,
  company_id,
  work_context_id,
  resource_code,
  action_code
);

DO $$
DECLARE
  version_row RECORD;
BEGIN
  FOR version_row IN
    SELECT acl_version_id, company_id
    FROM acl.acl_versions
    WHERE is_active = TRUE
      AND source_captured_at IS NULL
  LOOP
    PERFORM acl.capture_acl_version_source(
      version_row.acl_version_id,
      version_row.company_id,
      NULL
    );
  END LOOP;
END $$;

COMMIT;
