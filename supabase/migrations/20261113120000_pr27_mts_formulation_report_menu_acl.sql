-- PR27 "MTS Formulation Report": menu entry + ACL (VIEW only, everyone, company-scoped).
--
-- Menu: tx_code PR27, resource PROD_MTS_FORMULATION_REPORT, under Production (GRP_ACL_PRODUCTION), after PR26.
-- Access: CAP_EVERYONE_REPORTS -> VIEW only (same "Everyone" report pattern as PROC_GATE_REPORT, PR21, PO18). The report
-- itself restricts rows to the caller's own companies. Nothing here grants WRITE / EDIT / APPROVE.
--
-- ACL source is immutable once captured (CLAUDE.md pattern #4), so after the live grant every company gets a NEW
-- acl_version (captured + snapshotted + activated) and its users' menu snapshots are rebuilt -- the same proven shape as
-- 20261103180000. Idempotent: the menu rows and the grant are guarded; a re-run only adds one more version bump.

BEGIN;

INSERT INTO erp_menu.menu_master (menu_code, resource_code, title, description, route_path, menu_type, universe, is_system, display_order, is_active, created_by, tx_code)
SELECT 'PROD_MTS_FORMULATION_REPORT', 'PROD_MTS_FORMULATION_REPORT', 'MTS Formulation Report',
       'Every verified MTS production: the SFG and the RM / INT it used, then each SKU and the PM it used, with formulation vs actual material, dosage, quantities and variance.',
       '/dashboard/production/mts-formulation-report', 'PAGE', 'ACL', true, 133, true, 'system', 'PR27'
WHERE NOT EXISTS (SELECT 1 FROM erp_menu.menu_master WHERE menu_code = 'PROD_MTS_FORMULATION_REPORT');

INSERT INTO acl.menu_master (menu_code, display_name, is_system)
SELECT 'PROD_MTS_FORMULATION_REPORT', 'MTS Formulation Report', true
WHERE NOT EXISTS (SELECT 1 FROM acl.menu_master WHERE menu_code = 'PROD_MTS_FORMULATION_REPORT');

INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order, created_by)
SELECT parent.id, child.id, 133, 'system'
FROM erp_menu.menu_master parent, erp_menu.menu_master child
WHERE parent.menu_code = 'GRP_ACL_PRODUCTION' AND child.menu_code = 'PROD_MTS_FORMULATION_REPORT'
  AND NOT EXISTS (SELECT 1 FROM erp_menu.menu_tree t WHERE t.child_menu_id = child.id);

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)
SELECT 'CAP_EVERYONE_REPORTS', mm.id, 'VIEW', true, true
FROM acl.menu_master mm WHERE mm.menu_code = 'PROD_MTS_FORMULATION_REPORT'
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
    FOR UPDATE
  LOOP
    INSERT INTO acl.acl_versions (company_id, version_number, description, is_active, created_by)
    VALUES (
      current_version.company_id,
      current_version.version_number + 1,
      'PR27 MTS Formulation Report: VIEW for everyone (CAP_EVERYONE_REPORTS)',
      false,
      current_version.created_by
    )
    RETURNING acl_version_id INTO next_version_id;

    PERFORM acl.capture_acl_version_source(next_version_id, current_version.company_id, current_version.created_by);
    PERFORM acl.generate_acl_snapshot(next_version_id, current_version.company_id);

    UPDATE acl.acl_versions SET is_active = false WHERE acl_version_id = current_version.acl_version_id;
    UPDATE acl.acl_versions SET is_active = true WHERE acl_version_id = next_version_id;

    FOR affected_user IN
      SELECT DISTINCT auth_user_id, company_id, work_context_id
      FROM erp_acl.user_work_contexts
      WHERE company_id = current_version.company_id
    LOOP
      PERFORM public.rebuild_acl_menu_snapshot(affected_user.auth_user_id, affected_user.company_id, affected_user.work_context_id);
    END LOOP;
  END LOOP;
END $$;

-- Verification (a): the menu rows exist exactly once and PR27 sits in the Production group.
DO $$
BEGIN
  IF (SELECT count(*) FROM erp_menu.menu_master WHERE tx_code = 'PR27') <> 1
     OR (SELECT count(*) FROM acl.menu_master WHERE menu_code = 'PROD_MTS_FORMULATION_REPORT') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM erp_menu.menu_tree t
       JOIN erp_menu.menu_master c ON c.id = t.child_menu_id AND c.menu_code = 'PROD_MTS_FORMULATION_REPORT'
       JOIN erp_menu.menu_master p ON p.id = t.parent_menu_id AND p.menu_code = 'GRP_ACL_PRODUCTION') THEN
    RAISE EXCEPTION 'PR27 menu registration verification failed';
  END IF;
END $$;

-- Verification (b): parity with the Gate Entry Report, which rides the same CAP_EVERYONE_REPORTS pattern -- everyone who can
-- VIEW it now also VIEWs the report. An explicit per-user DENY override is deliberate and keeps winning.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM acl.precomputed_acl_view ref
    JOIN acl.acl_versions av ON av.acl_version_id = ref.acl_version_id AND av.is_active
    WHERE ref.resource_code = 'PROC_GATE_REPORT' AND ref.action_code = 'VIEW' AND ref.decision = 'ALLOW'
      AND NOT EXISTS (
        SELECT 1 FROM acl.precomputed_acl_view pav
        WHERE pav.acl_version_id = ref.acl_version_id
          AND pav.auth_user_id = ref.auth_user_id
          AND pav.company_id = ref.company_id
          AND pav.work_context_id IS NOT DISTINCT FROM ref.work_context_id
          AND pav.resource_code = 'PROD_MTS_FORMULATION_REPORT'
          AND pav.action_code = 'VIEW'
          AND pav.decision IN ('ALLOW', 'DENY'))
  ) THEN
    RAISE EXCEPTION 'PR27 ACL verification failed: a Gate Report viewer has no decision for PROD_MTS_FORMULATION_REPORT';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
