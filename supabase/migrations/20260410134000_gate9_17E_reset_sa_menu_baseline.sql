/*
 * File-ID: 9.17E
 * File-Path: supabase/migrations/20260410134000_gate9_17E_reset_sa_menu_baseline.sql
 * Gate: 9
 * Phase: 9
 * Domain: MENU + CLEANUP
 * Purpose: Reset SA to a blank governance baseline with only SA Home and Menu Governance published.
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- 1) Remove project-linked governance/sample data
-- ============================================================

DELETE FROM erp_audit.workflow_events
WHERE module_code IN (
  SELECT module_code
  FROM acl.module_registry
  WHERE project_id IN (SELECT id FROM erp_master.projects)
);

DELETE FROM acl.workflow_requests
WHERE project_id IN (
  SELECT id
  FROM erp_master.projects
);

DELETE FROM acl.approver_map
WHERE module_code IN (
  SELECT module_code
  FROM acl.module_registry
  WHERE project_id IN (SELECT id FROM erp_master.projects)
);

DELETE FROM acl.company_module_map
WHERE module_code IN (
  SELECT module_code
  FROM acl.module_registry
  WHERE project_id IN (SELECT id FROM erp_master.projects)
);

DELETE FROM acl.module_registry
WHERE project_id IN (
  SELECT id
  FROM erp_master.projects
);

DELETE FROM erp_map.user_projects
WHERE project_id IN (
  SELECT id
  FROM erp_master.projects
);

DELETE FROM erp_map.company_projects
WHERE project_id IN (
  SELECT id
  FROM erp_master.projects
);

DELETE FROM erp_master.projects;

-- ============================================================
-- 2) Remove group master and mappings
-- ============================================================

DELETE FROM erp_map.company_group;

DELETE FROM erp_master.groups;

-- ============================================================
-- 3) Keep only SA Home + Menu Governance in SA menu registry
-- ============================================================

INSERT INTO erp_menu.menu_master (
  menu_code,
  resource_code,
  title,
  description,
  route_path,
  menu_type,
  universe,
  is_system,
  display_order,
  is_active,
  created_at,
  created_by
)
VALUES
  (
    'SA_HOME',
    'SA_HOME',
    'Dashboard',
    'Super Admin launch surface.',
    '/sa/home',
    'PAGE',
    'SA',
    TRUE,
    1,
    TRUE,
    now(),
    'SYSTEM'
  ),
  (
    'SA_MENU_GOVERNANCE',
    'SA_MENU_GOVERNANCE',
    'Menu Governance',
    'Create groups and assign pages from a blank SA baseline.',
    '/sa/menu',
    'PAGE',
    'SA',
    TRUE,
    2,
    TRUE,
    now(),
    'SYSTEM'
  )
ON CONFLICT (menu_code) DO UPDATE
SET
  resource_code = EXCLUDED.resource_code,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  route_path = EXCLUDED.route_path,
  menu_type = EXCLUDED.menu_type,
  universe = EXCLUDED.universe,
  is_system = EXCLUDED.is_system,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active,
  updated_at = now(),
  updated_by = 'SYSTEM';

DELETE FROM erp_menu.menu_tree
WHERE child_menu_id IN (
    SELECT id
    FROM erp_menu.menu_master
    WHERE universe = 'SA'
  )
   OR parent_menu_id IN (
    SELECT id
    FROM erp_menu.menu_master
    WHERE universe = 'SA'
  );

DELETE FROM erp_menu.menu_master
WHERE universe = 'SA'
  AND menu_code NOT IN ('SA_HOME', 'SA_MENU_GOVERNANCE');

UPDATE erp_menu.menu_master
SET
  display_order = CASE menu_code
    WHEN 'SA_HOME' THEN 1
    WHEN 'SA_MENU_GOVERNANCE' THEN 2
    ELSE display_order
  END,
  is_active = TRUE,
  updated_at = now(),
  updated_by = 'SYSTEM'
WHERE menu_code IN ('SA_HOME', 'SA_MENU_GOVERNANCE');

-- ============================================================
-- 4) Flush published menu caches so old SA_ROOT/Admin Root disappears
-- ============================================================

DELETE FROM erp_menu.menu_snapshot
WHERE universe = 'SA';

DELETE FROM erp_cache.session_menu_snapshot
WHERE universe = 'SA';

COMMIT;
