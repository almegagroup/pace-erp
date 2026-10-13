-- L3 Manager subordinate scope + Procurement exclusivity — PROD cleanup (2026-10-13)
--
-- Business owner rules (2026-10-13):
--   * Bijon Kanabar (P0074) = 2nd ACL-MASTER (same company + work context set
--     as P0076).                                         -> applied via MCP
--   * L3 Manager does everything their subordinates do in their company and
--     approves subordinates' work, never their own.      -> applied via MCP
--   * Rupankar (P0065) = L3 Manager of CMP011 (primary) and CMP005.
--                                                        -> applied via MCP
--   * Procurement is Supply Chain + ACL-MASTER (P0076/P0074) only, except a
--     page's explicit dependency access.                 -> L3 DENY overrides applied via MCP
--
-- What is left (the Supabase MCP blocks DELETE statements behind a
-- confirmation that never reaches the session) — run once in the PROD SQL
-- editor. Idempotent: re-running is a no-op.

BEGIN;

-- 1. L3 Manager approver rows added on 2026-10-13 for Procurement documents
--    (PO / STO). Procurement approval stays with Supply Chain + Director.
DELETE FROM acl.approver_map
WHERE approver_role_code = 'L3_MANAGER'
  AND resource_code IN ('PROC_PO_ORDER_APPROVALS', 'PROC_STO_LIST');

-- 2. Supply-Chain-only Procurement capabilities copied onto MANAGEMENT on
--    2026-10-13. Removing them keeps Procurement out of every future L3
--    Manager too (today's four are additionally covered by DENY overrides).
DELETE FROM acl.work_context_capabilities w
USING erp_acl.work_contexts wc
WHERE wc.work_context_id = w.work_context_id
  AND upper(trim(wc.work_context_name)) = 'MANAGEMENT'
  AND w.capability_code IN ('CAP_PROC_BUYER', 'CAP_PROC_PLANNING_EDIT', 'CAP_PROC_SETUP', 'CAP_PROC_STO', 'CAP_PROC_TRANSPORTER');

-- 3. Publish: new ACL version per affected company + menu rebuild.
DO $$
DECLARE
  v record;
  new_id uuid;
  u record;
BEGIN
  FOR v IN
    SELECT av.*
    FROM acl.acl_versions av
    WHERE av.is_active
      AND EXISTS (
        SELECT 1 FROM erp_acl.work_contexts wc
        WHERE wc.company_id = av.company_id AND upper(trim(wc.work_context_name)) = 'MANAGEMENT' AND wc.is_active
      )
  LOOP
    INSERT INTO acl.acl_versions (company_id, version_number, description, is_active, created_by)
    VALUES (v.company_id, v.version_number + 1, 'Procurement out of MANAGEMENT; L3 PO/STO approver rows removed', false, v.created_by)
    RETURNING acl_version_id INTO new_id;
    PERFORM acl.capture_acl_version_source(new_id, v.company_id, v.created_by);
    PERFORM acl.generate_acl_snapshot(new_id, v.company_id);
    UPDATE acl.acl_versions SET is_active = false WHERE acl_version_id = v.acl_version_id;
    UPDATE acl.acl_versions SET is_active = true WHERE acl_version_id = new_id;

    FOR u IN
      SELECT DISTINCT auth_user_id, company_id, work_context_id
      FROM erp_acl.user_work_contexts
      WHERE company_id = v.company_id
    LOOP
      PERFORM public.rebuild_acl_menu_snapshot(u.auth_user_id, u.company_id, u.work_context_id);
    END LOOP;
  END LOOP;
END $$;

COMMIT;

-- 4. Verify (expect: 0 rows / 0 count).
SELECT count(*) AS l3_procurement_approver_rows
FROM acl.approver_map
WHERE approver_role_code = 'L3_MANAGER'
  AND resource_code IN ('PROC_PO_ORDER_APPROVALS', 'PROC_STO_LIST');

WITH RECURSIVE grp AS (
  SELECT mm.id, mm.menu_code FROM erp_menu.menu_master mm WHERE mm.menu_code = 'GRP_ACL_PROCUREMENT'
  UNION ALL
  SELECT c.id, c.menu_code FROM erp_menu.menu_tree t
  JOIN erp_menu.menu_master c ON c.id = t.child_menu_id
  JOIN grp g ON g.id = t.parent_menu_id
)
SELECT u.user_code, p.resource_code, p.action_code
FROM acl.precomputed_acl_view p
JOIN grp ON grp.menu_code = p.resource_code
JOIN erp_core.users u ON u.auth_user_id = p.auth_user_id
JOIN erp_acl.user_roles ur ON ur.auth_user_id = p.auth_user_id
WHERE ur.role_code = 'L3_MANAGER'
  AND p.decision = 'ALLOW'
  AND p.acl_version_id IN (SELECT acl_version_id FROM acl.acl_versions WHERE is_active)
  AND NOT (p.resource_code = 'PROC_PO_LIST' AND p.action_code = 'VIEW'); -- GRN/QA dependency, same as Stores/Quality
