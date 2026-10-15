-- POTMP Historical Operations Import — ACL/menu provisioning (DATA CONFIG).
-- Run through the approved MCP/admin connection on DEV only after the code is
-- deployed. This is intentionally NOT a migration: menus and permissions are
-- operational ACL configuration.
--
-- Scope decision: Director and ACL-MASTER only, CMP003/CMP005/CMP011. Historical
-- import has a separate resource from PO21 and must not inherit PO21 access.
-- The handler also validates the selected company on every dry-run and commit.
--
-- After applying: create a NEW ACL version per company, capture its source,
-- generate/activate ACL snapshots, rebuild affected menu snapshots, then run
-- acl-master-drift-check and dependency-provisioning-check. Do not run on PROD
-- without the owner's separate approval.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM erp_menu.menu_master WHERE tx_code = 'POTMP' AND menu_code <> 'PROC_HISTORICAL_OPERATIONS_IMPORT') THEN
    RAISE EXCEPTION 'TX code POTMP is already used by another menu in this database.';
  END IF;
END $$;

INSERT INTO erp_menu.menu_master (menu_code, resource_code, title, description, route_path, menu_type, universe, is_system, display_order, is_active, created_by, tx_code)
SELECT 'PROC_HISTORICAL_OPERATIONS_IMPORT', 'PROC_HISTORICAL_OPERATIONS_IMPORT', 'Historical Operations Import',
       'Controlled historical Production and FG Dispatch analytical import',
       '/dashboard/procurement/historical-operations-import', 'PAGE', 'ACL', false, 21, true, 'HISTORICAL_OPERATIONS_SETUP', 'POTMP'
WHERE NOT EXISTS (SELECT 1 FROM erp_menu.menu_master WHERE menu_code = 'PROC_HISTORICAL_OPERATIONS_IMPORT');

INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order)
SELECT parent.id, child.id, 21
FROM erp_menu.menu_master parent, erp_menu.menu_master child
WHERE parent.menu_code = 'GRP_ACL_PROCUREMENT' AND child.menu_code = 'PROC_HISTORICAL_OPERATIONS_IMPORT'
  AND NOT EXISTS (SELECT 1 FROM erp_menu.menu_tree existing WHERE existing.child_menu_id = child.id);

INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
SELECT 'PROC_HISTORICAL_OPERATIONS_IMPORT', 'Historical Operations Import',
       'POTMP dry-run and commit of analytical historical operations facts', true
WHERE NOT EXISTS (SELECT 1 FROM acl.menu_master WHERE menu_code = 'PROC_HISTORICAL_OPERATIONS_IMPORT');

INSERT INTO acl.capabilities (capability_code, capability_name, description, is_system)
SELECT 'CAP_HISTORICAL_OPERATIONS_IMPORT', 'Historical Operations Import',
       'Director / ACL-MASTER controlled historical analytical import', false
WHERE NOT EXISTS (SELECT 1 FROM acl.capabilities WHERE capability_code = 'CAP_HISTORICAL_OPERATIONS_IMPORT');

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)
SELECT 'CAP_HISTORICAL_OPERATIONS_IMPORT', menu.id, action.action, true, true
FROM acl.menu_master menu
CROSS JOIN (VALUES ('VIEW'), ('WRITE')) AS action(action)
WHERE menu.menu_code = 'PROC_HISTORICAL_OPERATIONS_IMPORT'
  AND NOT EXISTS (SELECT 1 FROM acl.capability_menu_actions existing WHERE existing.capability_code = 'CAP_HISTORICAL_OPERATIONS_IMPORT' AND existing.menu_id = menu.id AND existing.action = action.action);

INSERT INTO acl.role_capabilities (role_code, capability_code)
SELECT 'DIRECTOR', 'CAP_HISTORICAL_OPERATIONS_IMPORT'
WHERE NOT EXISTS (SELECT 1 FROM acl.role_capabilities WHERE role_code = 'DIRECTOR' AND capability_code = 'CAP_HISTORICAL_OPERATIONS_IMPORT');

INSERT INTO acl.work_context_capabilities (work_context_id, capability_code)
SELECT work_context.work_context_id, 'CAP_HISTORICAL_OPERATIONS_IMPORT'
FROM erp_acl.work_contexts work_context
JOIN erp_master.companies company ON company.id = work_context.company_id AND company.company_code IN ('CMP003', 'CMP005', 'CMP011')
WHERE work_context.is_active AND work_context.work_context_name IN ('DIRECTOR', 'ACL-MASTER')
  AND NOT EXISTS (SELECT 1 FROM acl.work_context_capabilities existing WHERE existing.work_context_id = work_context.work_context_id AND existing.capability_code = 'CAP_HISTORICAL_OPERATIONS_IMPORT');

COMMIT;
