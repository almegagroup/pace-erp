/*
 * Menu snapshot: show every ACL-universe page/group, mark denied ones
 * is_visible=false instead of omitting them entirely.
 *
 * Only the live 4-param erp_menu.generate_menu_snapshot(user, company,
 * work_context, universe) is changed — this is the one actually called by
 * public.rebuild_acl_menu_snapshot(). The legacy 3-param overload (no
 * work_context_id) is left untouched; nothing in the codebase calls it.
 *
 * SA branch is unchanged (SA always sees everything, is_visible stays TRUE).
 *
 * ACL branch: previously only inserted menus reachable from an ALLOW+VIEW
 * decision (walking up the parent chain). Now inserts every active
 * ACL-universe menu_master row unconditionally, computing is_visible per
 * row: PAGE = does this user have ALLOW+VIEW on its resource_code; GROUP =
 * does it have at least one visible PAGE child. Verified live (2026-07-28)
 * that the ACL menu hierarchy is exactly 2 levels (GROUP -> PAGE, no
 * group-of-groups) and menu_type only ever PAGE/GROUP, so a single JOIN
 * (not a recursive CTE) correctly computes group visibility.
 */

CREATE OR REPLACE FUNCTION erp_menu.generate_menu_snapshot(
  p_user_id uuid,
  p_company_id uuid,
  p_work_context_id uuid,
  p_universe text
)
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
$function$;
