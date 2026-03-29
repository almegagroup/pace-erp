/*
 * File-ID: 9.17C
 * File-Path: supabase/migrations/20260410119000_gate9_17C_sync_sa_menu_registry.sql
 * Gate: 9
 * Phase: 9
 * Domain: MENU
 * Purpose: Sync SA registry with top-level steering pages and deep admin routes
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- Ensure SA root exists
-- ============================================================

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
  'SA_ROOT',
  'SA_ROOT',
  'Admin Root',
  NULL,
  'GROUP',
  'SA',
  true,
  0,
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

-- ============================================================
-- Upsert SA pages used by steering and deep admin workflows
-- ============================================================

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
VALUES
  ('SA_HOME', 'SA_HOME', 'Dashboard', '/sa/home', 'PAGE', 'SA', true, 1, true, now(), 'SYSTEM'),
  ('SA_CONTROL_PANEL', 'SA_CONTROL_PANEL', 'Control Panel', '/sa/control-panel', 'PAGE', 'SA', true, 2, true, now(), 'SYSTEM'),
  ('SA_COMPANY_CREATE', 'SA_COMPANY_CREATE', 'Create Company', '/sa/company/create', 'PAGE', 'SA', true, 3, true, now(), 'SYSTEM'),
  ('SA_PROJECT_MASTER', 'SA_PROJECT_MASTER', 'Project Master', '/sa/project-master', 'PAGE', 'SA', true, 4, true, now(), 'SYSTEM'),
  ('SA_USERS', 'SA_USERS', 'User Control', '/sa/users', 'PAGE', 'SA', true, 5, true, now(), 'SYSTEM'),
  ('SA_ROLE_PERMISSIONS', 'SA_ROLE_PERMISSIONS', 'Role Permissions', '/sa/acl/role-permissions', 'PAGE', 'SA', true, 6, true, now(), 'SYSTEM'),
  ('SA_APPROVAL_RULES', 'SA_APPROVAL_RULES', 'Approval Rules', '/sa/approval-rules', 'PAGE', 'SA', true, 7, true, now(), 'SYSTEM'),
  ('SA_COMPANY_MODULE_MAP', 'SA_COMPANY_MODULE_MAP', 'Company Modules', '/sa/acl/company-modules', 'PAGE', 'SA', true, 8, true, now(), 'SYSTEM'),
  ('SA_SIGNUP_REQUESTS', 'SA_SIGNUP_REQUESTS', 'Signup Requests', '/sa/signup-requests', 'PAGE', 'SA', true, 9, true, now(), 'SYSTEM'),
  ('SA_SYSTEM_HEALTH', 'SA_SYSTEM_HEALTH', 'System Health', '/sa/system-health', 'PAGE', 'SA', true, 1, true, now(), 'SYSTEM'),
  ('SA_AUDIT', 'SA_AUDIT', 'Audit Viewer', '/sa/audit', 'PAGE', 'SA', true, 2, true, now(), 'SYSTEM'),
  ('SA_SESSIONS', 'SA_SESSIONS', 'Session Control', '/sa/sessions', 'PAGE', 'SA', true, 3, true, now(), 'SYSTEM'),
  ('SA_USER_ROLES', 'SA_USER_ROLES', 'User Roles', '/sa/users/roles', 'PAGE', 'SA', true, 1, true, now(), 'SYSTEM'),
  ('SA_USER_SCOPE', 'SA_USER_SCOPE', 'User Scope', '/sa/users/scope', 'PAGE', 'SA', true, 2, true, now(), 'SYSTEM')
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

-- ============================================================
-- Re-parent SA pages under top-level steering nodes with deterministic ordering
-- ============================================================

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
      ('SA_APPROVAL_RULES', 'SA_ROOT', 7),
      ('SA_COMPANY_MODULE_MAP', 'SA_ROOT', 8),
      ('SA_SIGNUP_REQUESTS', 'SA_ROOT', 9),
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
  JOIN erp_menu.menu_master parent
    ON parent.menu_code = menu_links.parent_code
  JOIN erp_menu.menu_master child
    ON child.menu_code = menu_links.child_code
)
DELETE FROM erp_menu.menu_tree
WHERE child_menu_id IN (
  SELECT child_menu_id
  FROM resolved_links
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
      ('SA_APPROVAL_RULES', 'SA_ROOT', 7),
      ('SA_COMPANY_MODULE_MAP', 'SA_ROOT', 8),
      ('SA_SIGNUP_REQUESTS', 'SA_ROOT', 9),
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
  JOIN erp_menu.menu_master parent
    ON parent.menu_code = menu_links.parent_code
  JOIN erp_menu.menu_master child
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
