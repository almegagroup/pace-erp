/*
 * File-ID: 7.3D
 * File-Path: supabase/migrations/20260410103000_gate7_7_3D_sa_global_snapshot_builder_fix.sql
 * Gate: 7
 * Phase: 7
 * Domain: MENU
 * Purpose: Rewrite snapshot builder to support SA global + ACL scoped logic
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- FUNCTION REWRITE
-- ============================================================

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

  -- ============================================================
  -- 🔴 VALIDATION
  -- ============================================================

  IF p_universe NOT IN ('SA', 'ACL') THEN
    RAISE EXCEPTION 'Invalid universe: %', p_universe;
  END IF;

  IF p_universe = 'ACL' AND p_company_id IS NULL THEN
    RAISE EXCEPTION 'ACL snapshot requires company_id';
  END IF;

  -- ============================================================
  -- 🟡 SA BRANCH (GLOBAL)
  -- ============================================================

  IF p_universe = 'SA' THEN

    -- version (global per user)
    SELECT COALESCE(MAX(snapshot_version), 0) + 1
    INTO v_next_version
    FROM erp_menu.menu_snapshot
    WHERE user_id = p_user_id
      AND universe = 'SA';

    -- delete old SA snapshot
    DELETE FROM erp_menu.menu_snapshot
    WHERE user_id = p_user_id
      AND universe = 'SA';

    -- insert new snapshot (NO company_id)
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
      created_at
    )
    SELECT
      p_user_id,
      NULL,                      -- 🔥 GLOBAL
      'SA',
      v_next_version,
      m.menu_code,
      m.resource_code,
      m.route_path,
      m.menu_type,
      mt.parent_menu_code,
      m.display_order,
      true,
      now()
    FROM erp_menu.menu_master m
    LEFT JOIN erp_menu.menu_tree mt
      ON mt.child_menu_id = m.id
    WHERE m.universe = 'SA'
      AND m.is_active = true;

    RETURN;
  END IF;

  -- ============================================================
  -- 🔵 ACL BRANCH (COMPANY SCOPED)
  -- ============================================================

  -- version per user + company
  SELECT COALESCE(MAX(snapshot_version), 0) + 1
  INTO v_next_version
  FROM erp_menu.menu_snapshot
  WHERE user_id = p_user_id
    AND company_id = p_company_id
    AND universe = 'ACL';

  -- delete old snapshot
  DELETE FROM erp_menu.menu_snapshot
  WHERE user_id = p_user_id
    AND company_id = p_company_id
    AND universe = 'ACL';

  -- insert snapshot
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
    mt.parent_menu_code,
    m.display_order,
    true,
    now()
  FROM erp_menu.menu_master m
  LEFT JOIN erp_menu.menu_tree mt
    ON mt.child_menu_id = m.id
  WHERE m.universe = 'ACL'
    AND m.is_active = true;

END;

$$;

COMMIT;