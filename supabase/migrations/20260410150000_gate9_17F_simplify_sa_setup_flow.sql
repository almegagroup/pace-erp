/*
 * File-ID: 9.17F
 * File-Path: supabase/migrations/20260410150000_gate9_17F_simplify_sa_setup_flow.sql
 * Gate: 9
 * Phase: 9
 * Domain: MENU
 * Purpose: Simplify SA navigation into a guided setup flow without changing backend ACL/runtime behavior.
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- 1) Canonical SA root
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
VALUES (
  'SA_ROOT',
  'SA_ROOT',
  'Super Admin',
  'Super Admin governance root.',
  NULL,
  'GROUP',
  'SA',
  TRUE,
  0,
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

-- ============================================================
-- 2) Canonical SA menu registry
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
  ('SA_START_HERE','SA_START_HERE','Start Here','Begin the setup cycle with dashboard readiness and the main control panel.',NULL,'GROUP','SA',TRUE,1,TRUE,now(),'SYSTEM'),
  ('SA_ORGANIZATION_SETUP','SA_ORGANIZATION_SETUP','Organization Setup','Create company, team, project, and module foundations before access rules.',NULL,'GROUP','SA',TRUE,2,TRUE,now(),'SYSTEM'),
  ('SA_ACCESS_SETUP','SA_ACCESS_SETUP','Access Setup','Wire pages into modules, build screen packs, and set role baselines.',NULL,'GROUP','SA',TRUE,3,TRUE,now(),'SYSTEM'),
  ('SA_USER_ONBOARDING','SA_USER_ONBOARDING','User Onboarding','Approve people, assign roles, and bind company plus work-scope access.',NULL,'GROUP','SA',TRUE,4,TRUE,now(),'SYSTEM'),
  ('SA_WORKFLOW_SETUP','SA_WORKFLOW_SETUP','Workflow Setup','Keep approval requirements, approvers, and report viewers explicit.',NULL,'GROUP','SA',TRUE,5,TRUE,now(),'SYSTEM'),
  ('SA_RUNTIME_ADMIN','SA_RUNTIME_ADMIN','Runtime Admin','Inspect sessions, audit trails, and system readiness after setup changes.',NULL,'GROUP','SA',TRUE,6,TRUE,now(),'SYSTEM'),
  ('SA_ADVANCED','SA_ADVANCED','Advanced','Less frequent governance surfaces for menu structure and company grouping.',NULL,'GROUP','SA',TRUE,7,TRUE,now(),'SYSTEM'),
  ('SA_HOME','SA_HOME','Dashboard','See readiness, setup flow, and launch the next Super Admin task.','/sa/home','PAGE','SA',TRUE,1,TRUE,now(),'SYSTEM'),
  ('SA_CONTROL_PANEL','SA_CONTROL_PANEL','Control Panel','Cross-check runtime health, recent activity, and the next setup step.','/sa/control-panel','PAGE','SA',TRUE,2,TRUE,now(),'SYSTEM'),
  ('SA_COMPANY_CREATE','SA_COMPANY_CREATE','Create Company','Create a new company foundation before teams, modules, or users are mapped.','/sa/company/create','PAGE','SA',TRUE,1,TRUE,now(),'SYSTEM'),
  ('SA_COMPANY_MANAGE','SA_COMPANY_MANAGE','Manage Company','Review or adjust existing company master data and lifecycle state.','/sa/company/manage','PAGE','SA',TRUE,2,TRUE,now(),'SYSTEM'),
  ('SA_DEPARTMENT_MASTER','SA_DEPARTMENT_MASTER','Department Master','Create company-specific teams. Each department auto-creates a DEPT_* work scope.','/sa/department-master','PAGE','SA',TRUE,3,TRUE,now(),'SYSTEM'),
  ('SA_PROJECT_MASTER','SA_PROJECT_MASTER','Project Master','Register business projects before mapping modules or page resources.','/sa/project-master','PAGE','SA',TRUE,4,TRUE,now(),'SYSTEM'),
  ('SA_PROJECT_MANAGE','SA_PROJECT_MANAGE','Project Manage','Review saved projects and keep project metadata clean.','/sa/projects/manage','PAGE','SA',TRUE,5,TRUE,now(),'SYSTEM'),
  ('SA_COMPANY_PROJECT_MAP','SA_COMPANY_PROJECT_MAP','Project Company Map','Decide which companies can use each business project.','/sa/projects/map','PAGE','SA',TRUE,6,TRUE,now(),'SYSTEM'),
  ('SA_MODULE_MASTER','SA_MODULE_MASTER','Module Master','Create and maintain business modules under the right project foundation.','/sa/module-master','PAGE','SA',TRUE,7,TRUE,now(),'SYSTEM'),
  ('SA_COMPANY_MODULE_MAP','SA_COMPANY_MODULE_MAP','Company Modules','Enable exact modules per company after projects and modules are ready.','/sa/acl/company-modules','PAGE','SA',TRUE,8,TRUE,now(),'SYSTEM'),
  ('SA_PAGE_RESOURCE_REGISTRY','SA_PAGE_RESOURCE_REGISTRY','Page Resource Registry','Register publishable business pages before permission mapping begins.','/sa/page-registry','PAGE','SA',TRUE,1,TRUE,now(),'SYSTEM'),
  ('SA_MODULE_RESOURCE_MAP','SA_MODULE_RESOURCE_MAP','Module Resource Map','Place exact pages inside modules before screen packs or approvals are assigned.','/sa/module-pages','PAGE','SA',TRUE,2,TRUE,now(),'SYSTEM'),
  ('SA_CAPABILITY_GOVERNANCE','SA_CAPABILITY_GOVERNANCE','Capability Governance','Build reusable screen packs and attach them to work scopes.','/sa/acl/capabilities','PAGE','SA',TRUE,3,TRUE,now(),'SYSTEM'),
  ('SA_ROLE_PERMISSIONS','SA_ROLE_PERMISSIONS','Role Permissions','Set role-level baseline permissions before applying user exceptions.','/sa/acl/role-permissions','PAGE','SA',TRUE,4,TRUE,now(),'SYSTEM'),
  ('SA_SIGNUP_REQUESTS','SA_SIGNUP_REQUESTS','Signup Requests','Approve or reject new ERP users before assigning live access.','/sa/signup-requests','PAGE','SA',TRUE,1,TRUE,now(),'SYSTEM'),
  ('SA_USERS','SA_USERS','Users','Inspect ERP users and jump into role or work-scope assignment.','/sa/users','PAGE','SA',TRUE,2,TRUE,now(),'SYSTEM'),
  ('SA_USER_ROLES','SA_USER_ROLES','User Roles','Assign the correct authority band to each approved user.','/sa/users/roles','PAGE','SA',TRUE,3,TRUE,now(),'SYSTEM'),
  ('SA_USER_SCOPE','SA_USER_SCOPE','User Scope','Bind parent company, work companies, team identity, and work scopes separately.','/sa/users/scope','PAGE','SA',TRUE,4,TRUE,now(),'SYSTEM'),
  ('SA_APPROVAL_POLICY','SA_APPROVAL_POLICY','Approval Policy','Mark the exact page actions that require approval.','/sa/approval-policy','PAGE','SA',TRUE,1,TRUE,now(),'SYSTEM'),
  ('SA_APPROVAL_RULES','SA_APPROVAL_RULES','Approval Rules','Assign who approves which action for which company and requester work scope.','/sa/approval-rules','PAGE','SA',TRUE,2,TRUE,now(),'SYSTEM'),
  ('SA_REPORT_VISIBILITY','SA_REPORT_VISIBILITY','Report Visibility','Grant report access separately from operational write access or approval authority.','/sa/report-visibility','PAGE','SA',TRUE,3,TRUE,now(),'SYSTEM'),
  ('SA_SESSIONS','SA_SESSIONS','Session Control','Review and revoke active ERP sessions after governance changes.','/sa/sessions','PAGE','SA',TRUE,1,TRUE,now(),'SYSTEM'),
  ('SA_AUDIT','SA_AUDIT','Audit Viewer','Inspect admin-side audit trails and change history.','/sa/audit','PAGE','SA',TRUE,2,TRUE,now(),'SYSTEM'),
  ('SA_SYSTEM_HEALTH','SA_SYSTEM_HEALTH','System Health','Validate database, ACL snapshot, and menu snapshot readiness.','/sa/system-health','PAGE','SA',TRUE,3,TRUE,now(),'SYSTEM'),
  ('SA_MENU_GOVERNANCE','SA_MENU_GOVERNANCE','Menu Governance','Advanced menu placement and ordering for published ERP navigation.','/sa/menu','PAGE','SA',TRUE,1,TRUE,now(),'SYSTEM'),
  ('SA_GROUP_GOVERNANCE','SA_GROUP_GOVERNANCE','Group Governance','Advanced company grouping and shared business structure governance.','/sa/groups','PAGE','SA',TRUE,2,TRUE,now(),'SYSTEM')
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

-- Canonical flow wins: any stale SA item drops out of projection.
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

-- ============================================================
-- 3) Rebuild SA tree in setup order
-- ============================================================

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
    ('SA_PROJECT_MASTER', 'SA_ORGANIZATION_SETUP', 4),
    ('SA_PROJECT_MANAGE', 'SA_ORGANIZATION_SETUP', 5),
    ('SA_COMPANY_PROJECT_MAP', 'SA_ORGANIZATION_SETUP', 6),
    ('SA_MODULE_MASTER', 'SA_ORGANIZATION_SETUP', 7),
    ('SA_COMPANY_MODULE_MAP', 'SA_ORGANIZATION_SETUP', 8),
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

-- ============================================================
-- 4) Flush SA snapshots so the new tree appears immediately
-- ============================================================

DELETE FROM erp_menu.menu_snapshot
WHERE universe = 'SA';

DELETE FROM erp_cache.session_menu_snapshot
WHERE universe = 'SA';

COMMIT;
