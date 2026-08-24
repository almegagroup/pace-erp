/*
 * Gate: 27.26 AC06 v3
 * Purpose: Split AC06 setup/rate/verify/close authority into ACL resources.
 * Rule: Director remains view-only; ACL-MASTER gains all operation resources
 *       only through its dedicated work context, never through role hard-coding.
 */

BEGIN;

-- module_resource_map references the canonical ERP menu resource, even for
-- hidden operational actions. The menu schema requires a PAGE route, so these
-- inert internal paths are never exposed because every grant is menu_hidden.
INSERT INTO erp_menu.menu_master (
  menu_code, resource_code, title, description, route_path, menu_type, universe, is_system, display_order, is_active, created_by, tx_code
)
VALUES
  ('ACC_SLOC_COSTING_SETUP', 'ACC_SLOC_COSTING_SETUP', 'AC06 Costing Setup Operation', 'Hidden AC06 SLOC/Costing Group maintenance operation.', '/__acl/ac06-setup', 'PAGE', 'ACL', true, 0, false, 'system', NULL),
  ('ACC_SLOC_COSTING_RATE', 'ACC_SLOC_COSTING_RATE', 'AC06 Costing Rate Operation', 'Hidden AC06 monthly rate entry operation.', '/__acl/ac06-rate', 'PAGE', 'ACL', true, 0, false, 'system', NULL),
  ('ACC_SLOC_COSTING_VERIFY', 'ACC_SLOC_COSTING_VERIFY', 'AC06 Costing Verify Operation', 'Hidden AC06 pending-rate verification operation.', '/__acl/ac06-verify', 'PAGE', 'ACL', true, 0, false, 'system', NULL),
  ('ACC_SLOC_COSTING_CLOSE', 'ACC_SLOC_COSTING_CLOSE', 'AC06 Costing Close Operation', 'Hidden AC06 monthly close operation.', '/__acl/ac06-close', 'PAGE', 'ACL', true, 0, false, 'system', NULL)
ON CONFLICT (menu_code) DO NOTHING;

INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
VALUES
  ('ACC_SLOC_COSTING_SETUP', 'AC06 Costing Setup Operation', 'Hidden AC06 SLOC/Costing Group maintenance operation.', true),
  ('ACC_SLOC_COSTING_RATE', 'AC06 Costing Rate Operation', 'Hidden AC06 monthly rate entry operation.', true),
  ('ACC_SLOC_COSTING_VERIFY', 'AC06 Costing Verify Operation', 'Hidden AC06 pending-rate verification operation.', true),
  ('ACC_SLOC_COSTING_CLOSE', 'AC06 Costing Close Operation', 'Hidden AC06 monthly close operation.', true)
ON CONFLICT (menu_code) DO NOTHING;

INSERT INTO acl.module_resource_map (module_code, resource_code)
VALUES
  ('MOD_ACCOUNTS', 'ACC_SLOC_COSTING_SETUP'),
  ('MOD_ACCOUNTS', 'ACC_SLOC_COSTING_RATE'),
  ('MOD_ACCOUNTS', 'ACC_SLOC_COSTING_VERIFY'),
  ('MOD_ACCOUNTS', 'ACC_SLOC_COSTING_CLOSE')
ON CONFLICT DO NOTHING;

INSERT INTO acl.capabilities (capability_code, capability_name, description, is_system)
VALUES
  ('CAP_AC06_VIEW_ACCOUNTS', 'AC06 View - Accounts', 'AC06 view/report access for Accounts.', true),
  ('CAP_AC06_VIEW_AUDITOR', 'AC06 View - Auditor', 'AC06 view/report access for Auditors.', true),
  ('CAP_AC06_VIEW_DIRECTOR', 'AC06 View - Director', 'AC06 view/report access for Directors.', true),
  ('CAP_AC06_SETUP_ACCOUNTS', 'AC06 Setup - Accounts', 'AC06 SLOC/Costing Group setup for Accounts.', true),
  ('CAP_AC06_SETUP_AUDITOR', 'AC06 Setup - Auditor', 'AC06 SLOC/Costing Group setup for Auditors.', true),
  ('CAP_AC06_RATE_ACCOUNTS', 'AC06 Rate Entry - Accounts', 'AC06 monthly rate entry for Accounts.', true),
  ('CAP_AC06_VERIFY_AUDITOR', 'AC06 Verify - Auditor', 'AC06 pending rate verification for Auditors.', true),
  ('CAP_AC06_CLOSE_AUDITOR', 'AC06 Close - Auditor', 'AC06 month close for Auditors.', true),
  ('CAP_AC06_ACL_MASTER', 'AC06 Operations - ACL Master', 'Full AC06 operation authority through ACL-MASTER context.', true)
ON CONFLICT (capability_code) DO NOTHING;

-- Copy only normal Accounts ranks; auditor/director authority is granted through
-- its dedicated capabilities and work contexts below.
INSERT INTO acl.role_capabilities (role_code, capability_code)
SELECT role_code, capability_code
FROM (
  SELECT rc.role_code, 'CAP_AC06_VIEW_ACCOUNTS'::text AS capability_code
  FROM acl.role_capabilities rc WHERE rc.capability_code = 'CAP_PROC_ACCOUNTS' AND rc.role_code NOT IN ('DIRECTOR', 'L1_AUDITOR', 'L2_AUDITOR')
  UNION ALL SELECT rc.role_code, 'CAP_AC06_SETUP_ACCOUNTS' FROM acl.role_capabilities rc WHERE rc.capability_code = 'CAP_PROC_ACCOUNTS' AND rc.role_code NOT IN ('DIRECTOR', 'L1_AUDITOR', 'L2_AUDITOR')
  UNION ALL SELECT rc.role_code, 'CAP_AC06_RATE_ACCOUNTS' FROM acl.role_capabilities rc WHERE rc.capability_code = 'CAP_PROC_ACCOUNTS' AND rc.role_code NOT IN ('DIRECTOR', 'L1_AUDITOR', 'L2_AUDITOR')
  UNION ALL SELECT rc.role_code, 'CAP_AC06_VIEW_AUDITOR' FROM acl.role_capabilities rc WHERE rc.capability_code = 'CAP_PI_AUDITOR' AND rc.role_code IN ('L1_AUDITOR', 'L2_AUDITOR')
  UNION ALL SELECT rc.role_code, 'CAP_AC06_SETUP_AUDITOR' FROM acl.role_capabilities rc WHERE rc.capability_code = 'CAP_PI_AUDITOR' AND rc.role_code IN ('L1_AUDITOR', 'L2_AUDITOR')
  UNION ALL SELECT rc.role_code, 'CAP_AC06_VERIFY_AUDITOR' FROM acl.role_capabilities rc WHERE rc.capability_code = 'CAP_PI_AUDITOR' AND rc.role_code IN ('L1_AUDITOR', 'L2_AUDITOR')
  UNION ALL SELECT rc.role_code, 'CAP_AC06_CLOSE_AUDITOR' FROM acl.role_capabilities rc WHERE rc.capability_code = 'CAP_PI_AUDITOR' AND rc.role_code IN ('L1_AUDITOR', 'L2_AUDITOR')
  UNION ALL SELECT 'DIRECTOR', 'CAP_AC06_VIEW_DIRECTOR'
  UNION ALL SELECT 'DIRECTOR', 'CAP_AC06_ACL_MASTER'
) AS grants
ON CONFLICT DO NOTHING;

INSERT INTO acl.work_context_capabilities (work_context_id, capability_code)
SELECT wc.work_context_id, capability_code
FROM erp_acl.work_contexts wc
CROSS JOIN (VALUES
  ('ACCOUNTS', 'CAP_AC06_VIEW_ACCOUNTS'), ('ACCOUNTS', 'CAP_AC06_SETUP_ACCOUNTS'), ('ACCOUNTS', 'CAP_AC06_RATE_ACCOUNTS'),
  ('AUDIT', 'CAP_AC06_VIEW_AUDITOR'), ('AUDIT', 'CAP_AC06_SETUP_AUDITOR'), ('AUDIT', 'CAP_AC06_VERIFY_AUDITOR'), ('AUDIT', 'CAP_AC06_CLOSE_AUDITOR'),
  ('DIRECTOR', 'CAP_AC06_VIEW_DIRECTOR'),
  ('ACL-MASTER', 'CAP_AC06_ACL_MASTER')
) AS grants(work_context_name, capability_code)
WHERE wc.work_context_name = grants.work_context_name
ON CONFLICT DO NOTHING;

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)
SELECT grants.capability_code, mm.id, grants.action, true, grants.menu_visible
FROM (VALUES
  ('CAP_AC06_VIEW_ACCOUNTS', 'ACC_SLOC_COSTING_GROUP', 'VIEW', true),
  ('CAP_AC06_VIEW_AUDITOR', 'ACC_SLOC_COSTING_GROUP', 'VIEW', true),
  ('CAP_AC06_VIEW_DIRECTOR', 'ACC_SLOC_COSTING_GROUP', 'VIEW', true),
  ('CAP_AC06_SETUP_ACCOUNTS', 'ACC_SLOC_COSTING_SETUP', 'WRITE', false), ('CAP_AC06_SETUP_ACCOUNTS', 'ACC_SLOC_COSTING_SETUP', 'DELETE', false),
  ('CAP_AC06_SETUP_AUDITOR', 'ACC_SLOC_COSTING_SETUP', 'WRITE', false), ('CAP_AC06_SETUP_AUDITOR', 'ACC_SLOC_COSTING_SETUP', 'DELETE', false),
  ('CAP_AC06_RATE_ACCOUNTS', 'ACC_SLOC_COSTING_RATE', 'WRITE', false),
  ('CAP_AC06_VERIFY_AUDITOR', 'ACC_SLOC_COSTING_VERIFY', 'WRITE', false),
  ('CAP_AC06_CLOSE_AUDITOR', 'ACC_SLOC_COSTING_CLOSE', 'WRITE', false),
  ('CAP_AC06_ACL_MASTER', 'ACC_SLOC_COSTING_GROUP', 'VIEW', true),
  ('CAP_AC06_ACL_MASTER', 'ACC_SLOC_COSTING_SETUP', 'WRITE', false), ('CAP_AC06_ACL_MASTER', 'ACC_SLOC_COSTING_SETUP', 'DELETE', false),
  ('CAP_AC06_ACL_MASTER', 'ACC_SLOC_COSTING_RATE', 'WRITE', false),
  ('CAP_AC06_ACL_MASTER', 'ACC_SLOC_COSTING_VERIFY', 'WRITE', false),
  ('CAP_AC06_ACL_MASTER', 'ACC_SLOC_COSTING_CLOSE', 'WRITE', false)
) AS grants(capability_code, menu_code, action, menu_visible)
JOIN acl.menu_master mm ON mm.menu_code = grants.menu_code
ON CONFLICT DO NOTHING;

-- Capture new source data into a new version. Re-capturing an existing version
-- is intentionally forbidden by ACL governance, so each target company gets a
-- fresh immutable snapshot before it becomes active.
DO $$
DECLARE
  current_version record;
  next_version_id uuid;
BEGIN
  FOR current_version IN
    SELECT av.acl_version_id, av.company_id, av.version_number, av.created_by
    FROM acl.acl_versions av
    JOIN erp_master.companies company ON company.id = av.company_id
    WHERE av.is_active AND company.company_code IN ('CMP003', 'CMP006')
    FOR UPDATE
  LOOP
    INSERT INTO acl.acl_versions (company_id, version_number, description, is_active, created_by)
    VALUES (current_version.company_id, current_version.version_number + 1, 'AC06 v3 operation authority split', false, current_version.created_by)
    RETURNING acl_version_id INTO next_version_id;
    PERFORM acl.capture_acl_version_source(next_version_id, current_version.company_id, current_version.created_by);
    PERFORM acl.generate_acl_snapshot(next_version_id, current_version.company_id);
    UPDATE acl.acl_versions SET is_active = false WHERE acl_version_id = current_version.acl_version_id;
    UPDATE acl.acl_versions SET is_active = true WHERE acl_version_id = next_version_id;
  END LOOP;
END $$;

COMMIT;
