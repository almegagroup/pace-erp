/*
 * Disk-IO fix (prod "Disk IO Budget" warning, 2026-11-12).
 *
 * erp_menu.generate_menu_snapshot(…, 'ACL') used to DELETE + INSERT the whole
 * (user, company, work_context) menu on EVERY call, even when nothing changed.
 * It is called on every /api/me/menu cache miss (TTL 300s) for every work
 * context, so prod saw ~43k calls, 5.6M inserts + 5.6M deletes into a table
 * that holds ~19k live rows (snapshot_version reached 4000 for one pair).
 *
 * Now the function builds the new menu as a jsonb array, compares it with the
 * existing rows, and RETURNs without touching the table when they are
 * identical. When anything differs it behaves exactly as before (version bump,
 * delete, insert). snapshot_version is cache metadata only (never compared
 * anywhere), so it simply stops advancing while the content is unchanged.
 *
 * SA branch and the 3-argument overload are untouched.
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
SET search_path TO 'pg_catalog', 'public', 'acl', 'erp_acl', 'erp_audit', 'erp_cache', 'erp_core', 'erp_hr', 'erp_inventory', 'erp_map', 'erp_master', 'erp_menu', 'erp_meta', 'erp_procurement', 'erp_production'
AS $function$
DECLARE
  v_next_version INT;
  v_active_acl_version_id UUID;
  v_new jsonb;
  v_old jsonb;
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

  -- Build the would-be menu once, as an ordered jsonb array.
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
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'menu_code', a.menu_code,
        'resource_code', a.resource_code,
        'route_path', a.route_path,
        'menu_type', a.menu_type,
        'parent_menu_code', a.parent_menu_code,
        'display_order', COALESCE(a.tree_display_order, a.own_display_order),
        'is_visible', CASE
          WHEN a.menu_type = 'PAGE' THEN a.page_visible
          WHEN a.menu_type = 'GROUP' THEN COALESCE(gv.is_visible, FALSE)
          ELSE TRUE
        END,
        'title', a.title,
        'description', a.description,
        'tx_code', a.tx_code
      )
      ORDER BY a.menu_code, a.parent_menu_code, a.resource_code
    ),
    '[]'::jsonb
  )
  INTO v_new
  FROM all_acl_menus AS a
  LEFT JOIN group_visibility AS gv ON gv.group_id = a.id;

  -- Same shape, built from what is stored now.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'menu_code', s.menu_code,
        'resource_code', s.resource_code,
        'route_path', s.route_path,
        'menu_type', s.menu_type,
        'parent_menu_code', s.parent_menu_code,
        'display_order', s.display_order,
        'is_visible', s.is_visible,
        'title', s.title,
        'description', s.description,
        'tx_code', s.tx_code
      )
      ORDER BY s.menu_code, s.parent_menu_code, s.resource_code
    ),
    '[]'::jsonb
  )
  INTO v_old
  FROM erp_menu.menu_snapshot AS s
  WHERE s.user_id         = p_user_id
    AND s.company_id      = p_company_id
    AND s.work_context_id = p_work_context_id
    AND s.universe        = 'ACL';

  -- Nothing changed -> no DELETE, no INSERT, no WAL, no dead tuples.
  IF v_new = v_old AND v_old <> '[]'::jsonb THEN
    RETURN;
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

  INSERT INTO erp_menu.menu_snapshot (
    user_id, company_id, work_context_id, universe, snapshot_version,
    menu_code, resource_code, route_path, menu_type,
    parent_menu_code, display_order, is_visible,
    title, description, tx_code, created_at
  )
  SELECT
    p_user_id, p_company_id, p_work_context_id, 'ACL', v_next_version,
    x.menu_code, x.resource_code, x.route_path, x.menu_type,
    x.parent_menu_code, x.display_order, x.is_visible,
    x.title, x.description, x.tx_code, now()
  FROM jsonb_to_recordset(v_new) AS x(
    menu_code text, resource_code text, route_path text, menu_type text,
    parent_menu_code text, display_order integer, is_visible boolean,
    title text, description text, tx_code text
  )
  ORDER BY x.display_order, x.menu_code;
END;
$function$;
