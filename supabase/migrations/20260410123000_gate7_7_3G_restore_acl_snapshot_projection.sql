/*
 * File-ID: 7.3G
 * File-Path: supabase/migrations/20260410123000_gate7_7_3G_restore_acl_snapshot_projection.sql
 * Gate: 7
 * Phase: 7
 * Domain: MENU
 * Purpose: Restore ACL menu snapshot projection from precomputed ACL truth and include ancestor groups
 * Authority: Backend
 */

BEGIN;

CREATE OR REPLACE FUNCTION erp_menu.generate_menu_snapshot(
  p_user_id UUID,
  p_company_id UUID,
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

  IF p_universe = 'ACL' AND p_company_id IS NULL THEN
    RAISE EXCEPTION 'ACL snapshot requires company_id';
  END IF;

  IF p_universe = 'SA' THEN
    SELECT COALESCE(MAX(snapshot_version), 0) + 1
    INTO v_next_version
    FROM erp_menu.menu_snapshot
    WHERE user_id = p_user_id
      AND universe = 'SA';

    DELETE FROM erp_menu.menu_snapshot
    WHERE user_id = p_user_id
      AND universe = 'SA';

    INSERT INTO erp_menu.menu_snapshot (
      user_id,
      company_id,
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
      created_at
    )
    SELECT
      p_user_id,
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
      now()
    FROM erp_menu.menu_master m
    LEFT JOIN erp_menu.menu_tree mt
      ON mt.child_menu_id = m.id
    LEFT JOIN erp_menu.menu_master pm
      ON pm.id = mt.parent_menu_id
    WHERE m.universe = 'SA'
      AND m.is_active = true;

    RETURN;
  END IF;

  SELECT COALESCE(MAX(snapshot_version), 0) + 1
  INTO v_next_version
  FROM erp_menu.menu_snapshot
  WHERE user_id = p_user_id
    AND company_id = p_company_id
    AND universe = 'ACL';

  DELETE FROM erp_menu.menu_snapshot
  WHERE user_id = p_user_id
    AND company_id = p_company_id
    AND universe = 'ACL';

  WITH RECURSIVE allowed_acl_menus AS (
    SELECT DISTINCT m.id AS menu_id
    FROM acl.precomputed_acl_view pav
    JOIN erp_menu.menu_master m
      ON m.resource_code = pav.resource_code
    WHERE pav.auth_user_id = p_user_id
      AND pav.company_id = p_company_id
      AND pav.decision = 'ALLOW'
      AND pav.action_code = 'VIEW'
      AND m.universe = 'ACL'
      AND m.is_active = true
  ),
  ancestor_chain AS (
    SELECT menu_id
    FROM allowed_acl_menus

    UNION

    SELECT mt.parent_menu_id
    FROM erp_menu.menu_tree mt
    JOIN ancestor_chain ac
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
    created_at
  )
  SELECT
    p_user_id,
    p_company_id,
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
    now()
  FROM projected_acl_menus projected
  JOIN erp_menu.menu_master m
    ON m.id = projected.menu_id
  LEFT JOIN erp_menu.menu_tree mt
    ON mt.child_menu_id = m.id
  LEFT JOIN erp_menu.menu_master pm
    ON pm.id = mt.parent_menu_id
  WHERE m.universe = 'ACL'
    AND m.is_active = true
  ORDER BY COALESCE(mt.display_order, m.display_order), m.menu_code;
END;
$$;

COMMENT ON FUNCTION erp_menu.generate_menu_snapshot(UUID, UUID, TEXT)
IS 'Builds menu_snapshot from full SA registry or ACL precomputed_acl_view, including ancestor groups for ACL navigation projection.';

COMMIT;
