/*
 * File-ID: 9.12C
 * File-Path: supabase/migrations/20260410121000_gate9_12C_add_sa_org_bootstrap.sql
 * Gate: 9
 * Phase: 9
 * Domain: MENU
 * Purpose: Add SA organization bootstrap surface to the published SA registry
 * Authority: Backend
 */

BEGIN;

INSERT INTO erp_menu.menu_master (
  menu_code,
  resource_code,
  title,
  route_path,
  menu_type,
  universe,
  is_system,
  display_order,
  is_active,
  created_at,
  created_by
)
VALUES (
  'SA_ORG_BOOTSTRAP',
  'SA_ORG_BOOTSTRAP',
  'Organization Bootstrap',
  '/sa/org-bootstrap',
  'PAGE',
  'SA',
  true,
  11,
  true,
  now(),
  'SYSTEM'
)
ON CONFLICT (menu_code) DO UPDATE
SET
  title = EXCLUDED.title,
  route_path = EXCLUDED.route_path,
  menu_type = EXCLUDED.menu_type,
  universe = EXCLUDED.universe,
  is_system = EXCLUDED.is_system,
  display_order = EXCLUDED.display_order,
  is_active = true,
  updated_at = now(),
  updated_by = 'SYSTEM';

WITH resolved_link AS (
  SELECT
    parent.id AS parent_menu_id,
    child.id AS child_menu_id
  FROM erp_menu.menu_master parent
  JOIN erp_menu.menu_master child
    ON child.menu_code = 'SA_ORG_BOOTSTRAP'
  WHERE parent.menu_code = 'SA_ROOT'
)
DELETE FROM erp_menu.menu_tree
WHERE child_menu_id IN (
  SELECT child_menu_id
  FROM resolved_link
);

WITH resolved_link AS (
  SELECT
    parent.id AS parent_menu_id,
    child.id AS child_menu_id
  FROM erp_menu.menu_master parent
  JOIN erp_menu.menu_master child
    ON child.menu_code = 'SA_ORG_BOOTSTRAP'
  WHERE parent.menu_code = 'SA_ROOT'
)
INSERT INTO erp_menu.menu_tree (
  parent_menu_id,
  child_menu_id,
  display_order,
  created_at,
  created_by
)
SELECT
  parent_menu_id,
  child_menu_id,
  11,
  now(),
  'SYSTEM'
FROM resolved_link;

COMMIT;
