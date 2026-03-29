/*
 * File-ID: 9.17D
 * File-Path: supabase/migrations/20260410131000_gate9_17D_add_sa_capability_governance_menu.sql
 * Gate: 9
 * Phase: 9
 * Domain: MENU
 * Purpose: Publish the SA capability governance workspace in the system menu registry
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
  'SA_CAPABILITY_GOVERNANCE',
  'SA_CAPABILITY_GOVERNANCE',
  'Capability Governance',
  '/sa/acl/capabilities',
  'PAGE',
  'SA',
  true,
  7,
  true,
  now(),
  'SYSTEM'
)
ON CONFLICT (menu_code) DO UPDATE
SET
  resource_code = EXCLUDED.resource_code,
  title = EXCLUDED.title,
  route_path = EXCLUDED.route_path,
  menu_type = EXCLUDED.menu_type,
  universe = EXCLUDED.universe,
  is_system = EXCLUDED.is_system,
  display_order = EXCLUDED.display_order,
  is_active = true,
  updated_at = now(),
  updated_by = 'SYSTEM';

WITH menu_order AS (
  SELECT *
  FROM (
    VALUES
      ('SA_HOME', 1),
      ('SA_CONTROL_PANEL', 2),
      ('SA_COMPANY_CREATE', 3),
      ('SA_PROJECT_MASTER', 4),
      ('SA_USERS', 5),
      ('SA_ROLE_PERMISSIONS', 6),
      ('SA_CAPABILITY_GOVERNANCE', 7),
      ('SA_APPROVAL_RULES', 8),
      ('SA_COMPANY_MODULE_MAP', 9),
      ('SA_SIGNUP_REQUESTS', 10),
      ('SA_MENU_GOVERNANCE', 11),
      ('SA_ORG_BOOTSTRAP', 12),
      ('SA_SYSTEM_HEALTH', 1),
      ('SA_AUDIT', 2),
      ('SA_SESSIONS', 3),
      ('SA_USER_ROLES', 1),
      ('SA_USER_SCOPE', 2)
  ) AS mapping(menu_code, display_order)
)
UPDATE erp_menu.menu_master AS menu
SET
  display_order = menu_order.display_order,
  updated_at = now(),
  updated_by = 'SYSTEM'
FROM menu_order
WHERE menu.menu_code = menu_order.menu_code;

WITH canonical_children AS (
  SELECT child.id AS child_menu_id
  FROM erp_menu.menu_master AS child
  WHERE child.menu_code IN (
    'SA_HOME',
    'SA_CONTROL_PANEL',
    'SA_COMPANY_CREATE',
    'SA_PROJECT_MASTER',
    'SA_USERS',
    'SA_ROLE_PERMISSIONS',
    'SA_CAPABILITY_GOVERNANCE',
    'SA_APPROVAL_RULES',
    'SA_COMPANY_MODULE_MAP',
    'SA_SIGNUP_REQUESTS',
    'SA_MENU_GOVERNANCE',
    'SA_ORG_BOOTSTRAP',
    'SA_SYSTEM_HEALTH',
    'SA_AUDIT',
    'SA_SESSIONS',
    'SA_USER_ROLES',
    'SA_USER_SCOPE'
  )
)
DELETE FROM erp_menu.menu_tree
WHERE parent_menu_id IN (
    SELECT id
    FROM erp_menu.menu_master
    WHERE menu_code IN ('SA_ROOT', 'SA_CONTROL_PANEL', 'SA_USERS')
  )
  OR child_menu_id IN (
    SELECT child_menu_id
    FROM canonical_children
  );

WITH menu_links AS (
  SELECT *
  FROM (
    VALUES
      ('SA_HOME', 'SA_ROOT', 1),
      ('SA_CONTROL_PANEL', 'SA_ROOT', 2),
      ('SA_COMPANY_CREATE', 'SA_ROOT', 3),
      ('SA_PROJECT_MASTER', 'SA_ROOT', 4),
      ('SA_USERS', 'SA_ROOT', 5),
      ('SA_ROLE_PERMISSIONS', 'SA_ROOT', 6),
      ('SA_CAPABILITY_GOVERNANCE', 'SA_ROOT', 7),
      ('SA_APPROVAL_RULES', 'SA_ROOT', 8),
      ('SA_COMPANY_MODULE_MAP', 'SA_ROOT', 9),
      ('SA_SIGNUP_REQUESTS', 'SA_ROOT', 10),
      ('SA_MENU_GOVERNANCE', 'SA_ROOT', 11),
      ('SA_ORG_BOOTSTRAP', 'SA_ROOT', 12),
      ('SA_SYSTEM_HEALTH', 'SA_CONTROL_PANEL', 1),
      ('SA_AUDIT', 'SA_CONTROL_PANEL', 2),
      ('SA_SESSIONS', 'SA_CONTROL_PANEL', 3),
      ('SA_USER_ROLES', 'SA_USERS', 1),
      ('SA_USER_SCOPE', 'SA_USERS', 2)
  ) AS mapping(child_code, parent_code, display_order)
),
resolved_links AS (
  SELECT
    parent.id AS parent_menu_id,
    child.id AS child_menu_id,
    menu_links.display_order
  FROM menu_links
  JOIN erp_menu.menu_master AS parent
    ON parent.menu_code = menu_links.parent_code
  JOIN erp_menu.menu_master AS child
    ON child.menu_code = menu_links.child_code
)
INSERT INTO erp_menu.menu_tree (
  parent_menu_id,
  child_menu_id,
  display_order,
  created_at,
  created_by
)
SELECT
  resolved_links.parent_menu_id,
  resolved_links.child_menu_id,
  resolved_links.display_order,
  now(),
  'SYSTEM'
FROM resolved_links;

COMMIT;
