-- AC05 MTS SKU Costing — Accounts department access
--
-- R-04 operational rollout. Run separately through MCP/direct SQL in each
-- environment. This is deliberately NOT a Supabase migration: capabilities,
-- work-context grants, ACL versions, snapshots and menu caches are
-- environment data.
--
-- Production applied: 2026-10-08 IST

BEGIN;

INSERT INTO acl.capabilities (capability_code, capability_name, description, is_system)
VALUES (
  'CAP_ACC_AC05_MTS_COSTING',
  'Accounts — AC05 MTS SKU Costing',
  'View and maintain AC05 MTS SKU Costing only from an Accounts work context.',
  true
)
ON CONFLICT DO NOTHING;

INSERT INTO acl.role_capabilities (role_code, capability_code)
SELECT role_code, 'CAP_ACC_AC05_MTS_COSTING'
FROM (VALUES
  ('L1_USER'), ('L1_MANAGER'), ('L2_USER'), ('L2_MANAGER'),
  ('L3_USER'), ('L3_MANAGER'), ('L4_USER'), ('L4_MANAGER'),
  ('L1_AUDITOR'), ('L2_AUDITOR')
) AS roles(role_code)
ON CONFLICT DO NOTHING;

INSERT INTO acl.work_context_capabilities (work_context_id, capability_code)
SELECT wc.work_context_id, 'CAP_ACC_AC05_MTS_COSTING'
FROM erp_acl.work_contexts wc
JOIN erp_master.departments d ON d.id = wc.department_id
WHERE d.department_name = 'ACCOUNTS'
ON CONFLICT DO NOTHING;

INSERT INTO acl.capability_menu_actions (
  capability_code, menu_id, action, allowed, menu_visible
)
SELECT 'CAP_ACC_AC05_MTS_COSTING', mm.id, grants.action, true, true
FROM (VALUES ('VIEW'), ('WRITE')) AS grants(action)
JOIN acl.menu_master mm ON mm.menu_code = 'ACC_AC05_MTS_SKU_COSTING'
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  current_version record;
  next_version_id uuid;
  affected_user record;
BEGIN
  FOR current_version IN
    SELECT av.acl_version_id, av.company_id, av.version_number, av.created_by
    FROM acl.acl_versions av
    WHERE av.is_active
      AND EXISTS (
        SELECT 1 FROM erp_acl.work_contexts wc
        JOIN erp_master.departments d ON d.id = wc.department_id
        WHERE wc.company_id = av.company_id
          AND d.department_name = 'ACCOUNTS'
      )
    FOR UPDATE
  LOOP
    INSERT INTO acl.acl_versions (
      company_id, version_number, description, is_active, created_by
    )
    VALUES (
      current_version.company_id,
      current_version.version_number + 1,
      'AC05: Accounts department View and Write access',
      false,
      current_version.created_by
    )
    RETURNING acl_version_id INTO next_version_id;

    PERFORM acl.capture_acl_version_source(
      next_version_id, current_version.company_id, current_version.created_by
    );
    PERFORM acl.generate_acl_snapshot(next_version_id, current_version.company_id);
    UPDATE acl.acl_versions SET is_active = false
    WHERE acl_version_id = current_version.acl_version_id;
    UPDATE acl.acl_versions SET is_active = true
    WHERE acl_version_id = next_version_id;

    FOR affected_user IN
      SELECT DISTINCT auth_user_id, company_id, work_context_id
      FROM erp_acl.user_work_contexts
      WHERE company_id = current_version.company_id
    LOOP
      PERFORM public.rebuild_acl_menu_snapshot(
        affected_user.auth_user_id,
        affected_user.company_id,
        affected_user.work_context_id
      );
    END LOOP;
  END LOOP;
END $$;

COMMIT;
