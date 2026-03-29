/*
 * File-ID: 9.12B
 * File-Path: supabase/migrations/20260410120000_gate9_12B_add_sa_menu_governance.sql
 * Gate: 9
 * Phase: 9
 * Domain: MENU
 * Purpose: Add SA menu governance surface to the published SA registry
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
  'SA_MENU_GOVERNANCE',
  'SA_MENU_GOVERNANCE',
  'Menu Governance',
  '/sa/menu',
  'PAGE',
  'SA',
  true,
  10,
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
    ON child.menu_code = 'SA_MENU_GOVERNANCE'
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
    ON child.menu_code = 'SA_MENU_GOVERNANCE'
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
  10,
  now(),
  'SYSTEM'
FROM resolved_link;

COMMIT;
