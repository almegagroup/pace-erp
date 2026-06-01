/*
 * Migration: Fix erp_menu.menu_snapshot unique constraint + generate_menu_snapshot version calculation
 *
 * Root cause:
 *   - Old 3-param generate_menu_snapshot stored ACL rows with work_context_id = NULL
 *   - New 4-param version conflicts because unique constraint does NOT include work_context_id
 *   - Version calculation in 4-param function only counted rows matching its own work_context_id
 *     → always got version 1 → conflicted with existing NULL rows at version 1
 *   - INSERT failed → session snapshot got 0 rows → dashboard blank
 *
 * Fix:
 *   1. Delete stale ACL rows with work_context_id = NULL
 *   2. Drop old constraint; replace with work_context_id-aware partial unique indices
 *   3. Fix 4-param generate_menu_snapshot: version calculation must span ALL
 *      work_context_ids for same user+company+universe to avoid version collisions
 */

-- ============================================================
-- Step 1: Clean up stale ACL rows with work_context_id = NULL
-- ============================================================

DELETE FROM erp_menu.menu_snapshot
WHERE universe = 'ACL'
  AND work_context_id IS NULL;

-- ============================================================
-- Step 2: Replace unique constraint with work_context_id-aware indices
-- ============================================================

ALTER TABLE erp_menu.menu_snapshot
  DROP CONSTRAINT IF EXISTS ux_menu_snapshot_acl;

DROP INDEX IF EXISTS erp_menu.ux_menu_snapshot_sa;
DROP INDEX IF EXISTS erp_menu.ux_menu_snapshot_acl;

-- SA universe: no company, no work_context
CREATE UNIQUE INDEX ux_menu_snapshot_sa
  ON erp_menu.menu_snapshot (user_id, universe, snapshot_version, menu_code)
  WHERE universe = 'SA'
    AND company_id IS NULL
    AND work_context_id IS NULL;

-- ACL universe: includes work_context_id — partitions per work context
CREATE UNIQUE INDEX ux_menu_snapshot_acl
  ON erp_menu.menu_snapshot (user_id, company_id, work_context_id, universe, snapshot_version, menu_code)
  WHERE universe = 'ACL'
    AND work_context_id IS NOT NULL;

-- ============================================================
-- Step 3: Fix 4-param generate_menu_snapshot version calculation
-- ============================================================
--
-- Change: version SELECT now spans ALL work_context_ids for the same
-- user+company+universe (not just the target work_context_id).
-- This ensures each re-generate gets a version higher than ALL existing
-- snapshots for that company — no version collision between work contexts.

CREATE OR REPLACE FUNCTION erp_menu.generate_menu_snapshot(
  p_user_id         uuid,
  p_company_id      uuid,
  p_work_context_id uuid,
  p_universe        text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'acl', 'erp_acl', 'erp_audit',
                   'erp_cache', 'erp_core', 'erp_hr', 'erp_map',
                   'erp_master', 'erp_menu', 'erp_meta'
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

  -- ── SA path ────────────────────────────────────────────────
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
      user_id, company_id, work_context_id, universe, snapshot_version,
      menu_code, resource_code, route_path, menu_type,
      parent_menu_code, display_order, is_visible,
      title, description, created_at
    )
    SELECT
      p_user_id, NULL, NULL, 'SA', v_next_version,
      m.menu_code, m.resource_code, m.route_path, m.menu_type,
      pm.menu_code, COALESCE(mt.display_order, m.display_order), TRUE,
      m.title, m.description, now()
    FROM erp_menu.menu_master AS m
    LEFT JOIN erp_menu.menu_tree AS mt ON mt.child_menu_id = m.id
    LEFT JOIN erp_menu.menu_master AS pm ON pm.id = mt.parent_menu_id
    WHERE m.universe = 'SA'
      AND m.is_active = TRUE;

    RETURN;
  END IF;

  -- ── ACL path ───────────────────────────────────────────────
  -- Version spans ALL work_context_ids for this user+company+universe.
  -- Prevents version collision when multiple work contexts coexist.
  SELECT COALESCE(MAX(snapshot_version), 0) + 1
    INTO v_next_version
    FROM erp_menu.menu_snapshot
   WHERE user_id    = p_user_id
     AND company_id = p_company_id
     AND universe   = 'ACL';

  DELETE FROM erp_menu.menu_snapshot
   WHERE user_id         = p_user_id
     AND company_id      = p_company_id
     AND work_context_id = p_work_context_id
     AND universe        = 'ACL';

  WITH RECURSIVE allowed_acl_menus AS (
    SELECT DISTINCT m.id AS menu_id
      FROM acl.precomputed_acl_view AS pav
      JOIN erp_menu.menu_master AS m ON m.resource_code = pav.resource_code
     WHERE pav.auth_user_id    = p_user_id
       AND pav.company_id      = p_company_id
       AND pav.work_context_id = p_work_context_id
       AND pav.decision        = 'ALLOW'
       AND pav.action_code     = 'VIEW'
       AND m.universe          = 'ACL'
       AND m.is_active         = TRUE
  ),
  ancestor_chain AS (
    SELECT menu_id FROM allowed_acl_menus
    UNION
    SELECT mt.parent_menu_id
      FROM erp_menu.menu_tree AS mt
      JOIN ancestor_chain AS ac ON ac.menu_id = mt.child_menu_id
     WHERE mt.parent_menu_id IS NOT NULL
  ),
  projected_acl_menus AS (
    SELECT DISTINCT menu_id FROM ancestor_chain
  )
  INSERT INTO erp_menu.menu_snapshot (
    user_id, company_id, work_context_id, universe, snapshot_version,
    menu_code, resource_code, route_path, menu_type,
    parent_menu_code, display_order, is_visible,
    title, description, created_at
  )
  SELECT
    p_user_id, p_company_id, p_work_context_id, 'ACL', v_next_version,
    m.menu_code, m.resource_code, m.route_path, m.menu_type,
    pm.menu_code, COALESCE(mt.display_order, m.display_order), TRUE,
    m.title, m.description, now()
  FROM projected_acl_menus AS projected
  JOIN erp_menu.menu_master AS m ON m.id = projected.menu_id
  LEFT JOIN erp_menu.menu_tree AS mt ON mt.child_menu_id = m.id
  LEFT JOIN erp_menu.menu_master AS pm ON pm.id = mt.parent_menu_id
  WHERE m.universe = 'ACL'
    AND m.is_active = TRUE
  ORDER BY COALESCE(mt.display_order, m.display_order), m.menu_code;
END;
$$;
