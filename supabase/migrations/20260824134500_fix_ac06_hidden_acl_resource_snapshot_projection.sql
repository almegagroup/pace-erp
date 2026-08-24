/*
 * Gate: 27.26 AC06 v3
 * Purpose: Keep hidden operation resources active for ACL snapshot projection.
 * Visibility remains governed by capability_menu_actions.menu_visible = false.
 */

BEGIN;

UPDATE erp_menu.menu_master
SET is_active = true, updated_at = now(), updated_by = 'system'
WHERE resource_code IN (
  'ACC_SLOC_COSTING_SETUP',
  'ACC_SLOC_COSTING_RATE',
  'ACC_SLOC_COSTING_VERIFY',
  'ACC_SLOC_COSTING_CLOSE'
);

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
    VALUES (current_version.company_id, current_version.version_number + 1, 'AC06 v3 hidden operation resource projection', false, current_version.created_by)
    RETURNING acl_version_id INTO next_version_id;
    PERFORM acl.capture_acl_version_source(next_version_id, current_version.company_id, current_version.created_by);
    PERFORM acl.generate_acl_snapshot(next_version_id, current_version.company_id);
    UPDATE acl.acl_versions SET is_active = false WHERE acl_version_id = current_version.acl_version_id;
    UPDATE acl.acl_versions SET is_active = true WHERE acl_version_id = next_version_id;
  END LOOP;
END $$;

COMMIT;
