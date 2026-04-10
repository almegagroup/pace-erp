/*
 * File-ID: 9.17H
 * File-Path: supabase/migrations/20260410193000_gate9_17H_add_sa_work_context_master.sql
 * Gate: 9
 * Phase: 9
 * Domain: MENU
 * Purpose: Add a dedicated SA Work Context Master screen to the guided setup flow.
 * Authority: Backend
 */

BEGIN;

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
VALUES (
  'SA_WORK_CONTEXT_MASTER',
  'SA_WORK_CONTEXT_MASTER',
  'Work Context Master',
  'Create manual runtime work scopes such as PROD_POWDER, QA_ADMIX, SCM_OPERATIONS, MGMT_ALL, or AUDIT_ALL.',
  '/sa/work-contexts',
  'PAGE',
  'SA',
  TRUE,
  4,
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
  is_active = TRUE,
  updated_at = now(),
  updated_by = 'SYSTEM';

UPDATE erp_menu.menu_master
SET
  display_order = CASE menu_code
    WHEN 'SA_PROJECT_MASTER' THEN 5
    WHEN 'SA_PROJECT_MANAGE' THEN 6
    WHEN 'SA_COMPANY_PROJECT_MAP' THEN 7
    WHEN 'SA_MODULE_MASTER' THEN 8
    WHEN 'SA_COMPANY_MODULE_MAP' THEN 9
    ELSE display_order
  END,
  updated_at = now(),
  updated_by = 'SYSTEM'
WHERE menu_code IN (
  'SA_PROJECT_MASTER',
  'SA_PROJECT_MANAGE',
  'SA_COMPANY_PROJECT_MAP',
  'SA_MODULE_MASTER',
  'SA_COMPANY_MODULE_MAP'
);

UPDATE erp_menu.menu_master
SET
  is_active = FALSE,
  updated_at = now(),
  updated_by = 'SYSTEM'
WHERE universe = 'SA'
  AND menu_code NOT IN (
    'SA_ROOT',
    'SA_START_HERE',
    'SA_ORGANIZATION_SETUP',
    'SA_ACCESS_SETUP',
    'SA_USER_ONBOARDING',
    'SA_WORKFLOW_SETUP',
    'SA_RUNTIME_ADMIN',
    'SA_ADVANCED',
    'SA_HOME',
    'SA_CONTROL_PANEL',
    'SA_COMPANY_CREATE',
    'SA_COMPANY_MANAGE',
    'SA_DEPARTMENT_MASTER',
    'SA_WORK_CONTEXT_MASTER',
    'SA_PROJECT_MASTER',
    'SA_PROJECT_MANAGE',
    'SA_COMPANY_PROJECT_MAP',
    'SA_MODULE_MASTER',
    'SA_COMPANY_MODULE_MAP',
    'SA_PAGE_RESOURCE_REGISTRY',
    'SA_MODULE_RESOURCE_MAP',
    'SA_CAPABILITY_GOVERNANCE',
    'SA_ROLE_PERMISSIONS',
    'SA_SIGNUP_REQUESTS',
    'SA_USERS',
    'SA_USER_ROLES',
    'SA_USER_SCOPE',
    'SA_APPROVAL_POLICY',
    'SA_APPROVAL_RULES',
    'SA_REPORT_VISIBILITY',
    'SA_SESSIONS',
    'SA_AUDIT',
    'SA_SYSTEM_HEALTH',
    'SA_MENU_GOVERNANCE',
    'SA_GROUP_GOVERNANCE'
  );

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

INSERT INTO erp_menu.menu_tree (
  parent_menu_id,
  child_menu_id,
  display_order,
  created_at,
  created_by
)
SELECT
  parent_menu.id,
  child_menu.id,
  mapping.display_order,
  now(),
  'SYSTEM'
FROM (
  VALUES
    ('SA_START_HERE', 'SA_ROOT', 1),
    ('SA_ORGANIZATION_SETUP', 'SA_ROOT', 2),
    ('SA_ACCESS_SETUP', 'SA_ROOT', 3),
    ('SA_USER_ONBOARDING', 'SA_ROOT', 4),
    ('SA_WORKFLOW_SETUP', 'SA_ROOT', 5),
    ('SA_RUNTIME_ADMIN', 'SA_ROOT', 6),
    ('SA_ADVANCED', 'SA_ROOT', 7),
    ('SA_HOME', 'SA_START_HERE', 1),
    ('SA_CONTROL_PANEL', 'SA_START_HERE', 2),
    ('SA_COMPANY_CREATE', 'SA_ORGANIZATION_SETUP', 1),
    ('SA_COMPANY_MANAGE', 'SA_ORGANIZATION_SETUP', 2),
    ('SA_DEPARTMENT_MASTER', 'SA_ORGANIZATION_SETUP', 3),
    ('SA_WORK_CONTEXT_MASTER', 'SA_ORGANIZATION_SETUP', 4),
    ('SA_PROJECT_MASTER', 'SA_ORGANIZATION_SETUP', 5),
    ('SA_PROJECT_MANAGE', 'SA_ORGANIZATION_SETUP', 6),
    ('SA_COMPANY_PROJECT_MAP', 'SA_ORGANIZATION_SETUP', 7),
    ('SA_MODULE_MASTER', 'SA_ORGANIZATION_SETUP', 8),
    ('SA_COMPANY_MODULE_MAP', 'SA_ORGANIZATION_SETUP', 9),
    ('SA_PAGE_RESOURCE_REGISTRY', 'SA_ACCESS_SETUP', 1),
    ('SA_MODULE_RESOURCE_MAP', 'SA_ACCESS_SETUP', 2),
    ('SA_CAPABILITY_GOVERNANCE', 'SA_ACCESS_SETUP', 3),
    ('SA_ROLE_PERMISSIONS', 'SA_ACCESS_SETUP', 4),
    ('SA_SIGNUP_REQUESTS', 'SA_USER_ONBOARDING', 1),
    ('SA_USERS', 'SA_USER_ONBOARDING', 2),
    ('SA_USER_ROLES', 'SA_USER_ONBOARDING', 3),
    ('SA_USER_SCOPE', 'SA_USER_ONBOARDING', 4),
    ('SA_APPROVAL_POLICY', 'SA_WORKFLOW_SETUP', 1),
    ('SA_APPROVAL_RULES', 'SA_WORKFLOW_SETUP', 2),
    ('SA_REPORT_VISIBILITY', 'SA_WORKFLOW_SETUP', 3),
    ('SA_SESSIONS', 'SA_RUNTIME_ADMIN', 1),
    ('SA_AUDIT', 'SA_RUNTIME_ADMIN', 2),
    ('SA_SYSTEM_HEALTH', 'SA_RUNTIME_ADMIN', 3),
    ('SA_MENU_GOVERNANCE', 'SA_ADVANCED', 1),
    ('SA_GROUP_GOVERNANCE', 'SA_ADVANCED', 2)
) AS mapping(child_code, parent_code, display_order)
JOIN erp_menu.menu_master child_menu
  ON child_menu.menu_code = mapping.child_code
JOIN erp_menu.menu_master parent_menu
  ON parent_menu.menu_code = mapping.parent_code;

DELETE FROM erp_menu.menu_snapshot
WHERE universe = 'SA';

DELETE FROM erp_cache.session_menu_snapshot
WHERE universe = 'SA';

COMMIT;
