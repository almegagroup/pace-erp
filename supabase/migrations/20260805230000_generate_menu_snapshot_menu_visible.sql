-- Section 30 (ACL_SSOT.md) — gate erp_menu.generate_menu_snapshot() on menu_visible.
--
-- Only the 4-param overload (p_user_id, p_company_id, p_work_context_id,
-- p_universe) is touched — this is the live path (SECURITY DEFINER, called via
-- the public.rebuild_*_menu_snapshot wrappers). The 3-param legacy overload
-- always inserts is_visible=TRUE unconditionally and is superseded; left
-- untouched.
--
-- Behavior: this engine already has a "show disabled items greyed, never omit
-- a row" design (migration 20260728120000) — a page nobody has ALLOW on still
-- gets a row with is_visible=false, so the sidebar tree stays structurally
-- stable. menu_visible=false is treated the same way: the resource is simply
-- excluded from allowed_resource_codes, so the page renders exactly like "no
-- ALLOW at all" — greyed, not a new third state. This reuses the existing,
-- already-accepted UX pattern instead of inventing a new one.
--
-- Change: allowed_resource_codes now also requires menu_visible = TRUE.
-- Everything else in the function is byte-for-byte unchanged.

CREATE OR REPLACE FUNCTION erp_menu.generate_menu_snapshot(p_user_id uuid, p_company_id uuid, p_work_context_id uuid, p_universe text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_next_version INT;
  v_active_acl_version_id UUID;
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
      user_id, company_id, work_context_id, universe, snapshot_version,
      menu_code, resource_code, route_path, menu_type,
      parent_menu_code, display_order, is_visible,
      title, description, tx_code, created_at
    )
    SELECT
      p_user_id, NULL, NULL, 'SA', v_next_version,
      m.menu_code, m.resource_code, m.route_path, m.menu_type,
      pm.menu_code, COALESCE(mt.display_order, m.display_order), TRUE,
      m.title, m.description, m.tx_code, now()
    FROM erp_menu.menu_master AS m
    LEFT JOIN erp_menu.menu_tree AS mt ON mt.child_menu_id = m.id
    LEFT JOIN erp_menu.menu_master AS pm ON pm.id = mt.parent_menu_id
    WHERE m.universe = 'SA'
      AND m.is_active = TRUE;

    RETURN;
  END IF;

  SELECT acl_version_id
    INTO v_active_acl_version_id
    FROM acl.acl_versions
   WHERE company_id = p_company_id
     AND is_active = TRUE;

  IF v_active_acl_version_id IS NULL THEN
    RAISE EXCEPTION 'ACL_ACTIVE_VERSION_NOT_FOUND';
  END IF;

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

  WITH allowed_resource_codes AS (
    SELECT DISTINCT pav.resource_code
      FROM acl.precomputed_acl_view AS pav
     WHERE pav.acl_version_id   = v_active_acl_version_id
       AND pav.auth_user_id     = p_user_id
       AND pav.company_id       = p_company_id
       AND pav.work_context_id  = p_work_context_id
       AND pav.decision         = 'ALLOW'
       AND pav.action_code      = 'VIEW'
       AND pav.menu_visible     = TRUE
  ),
  all_acl_menus AS (
    SELECT
      m.id, m.menu_code, m.resource_code, m.route_path, m.menu_type,
      m.title, m.description, m.tx_code, m.display_order AS own_display_order,
      mt.parent_menu_id, mt.display_order AS tree_display_order,
      pm.menu_code AS parent_menu_code,
      (m.menu_type = 'PAGE' AND m.resource_code IN (SELECT resource_code FROM allowed_resource_codes)) AS page_visible
    FROM erp_menu.menu_master AS m
    LEFT JOIN erp_menu.menu_tree AS mt ON mt.child_menu_id = m.id
    LEFT JOIN erp_menu.menu_master AS pm ON pm.id = mt.parent_menu_id
    WHERE m.universe = 'ACL'
      AND m.is_active = TRUE
  ),
  group_visibility AS (
    SELECT g.id AS group_id, COALESCE(bool_or(c.page_visible), FALSE) AS is_visible
    FROM all_acl_menus AS g
    LEFT JOIN all_acl_menus AS c ON c.parent_menu_id = g.id AND c.menu_type = 'PAGE'
    WHERE g.menu_type = 'GROUP'
    GROUP BY g.id
  )
  INSERT INTO erp_menu.menu_snapshot (
    user_id, company_id, work_context_id, universe, snapshot_version,
    menu_code, resource_code, route_path, menu_type,
    parent_menu_code, display_order, is_visible,
    title, description, tx_code, created_at
  )
  SELECT
    p_user_id, p_company_id, p_work_context_id, 'ACL', v_next_version,
    a.menu_code, a.resource_code, a.route_path, a.menu_type,
    a.parent_menu_code, COALESCE(a.tree_display_order, a.own_display_order),
    CASE
      WHEN a.menu_type = 'PAGE' THEN a.page_visible
      WHEN a.menu_type = 'GROUP' THEN COALESCE(gv.is_visible, FALSE)
      ELSE TRUE
    END,
    a.title, a.description, a.tx_code, now()
  FROM all_acl_menus AS a
  LEFT JOIN group_visibility AS gv ON gv.group_id = a.id
  ORDER BY COALESCE(a.tree_display_order, a.own_display_order), a.menu_code;
END;
$function$
