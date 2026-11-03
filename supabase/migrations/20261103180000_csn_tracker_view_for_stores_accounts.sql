-- CSN Tracker: view-only access for the Stores / Logistics (DO) and Accounts (Invoice/PGI) work contexts.
--
-- Why: an FG STO's CSN belongs to the RECEIVING company, but the SENDING company's Stores / Logistics /
-- Accounts users run the dispatch and need to see that consignment move. They only ever need to LOOK
-- (tracker + drawer), so this grants PROC_CSN_TRACKER:VIEW only -- never EDIT/WRITE/DELETE. Procurement
-- (CAP_PROC_BUYER / CAP_PROC_BUYER_VIEW), Director and ACL-MASTER permissions are untouched.
--
-- ACL source is immutable once captured (CLAUDE.md pattern #4): the grant is added to the live
-- capability table, then every affected company gets a NEW acl_version (captured + snapshotted +
-- activated) and its users' menu snapshots are rebuilt. Re-running this migration is a no-op for the
-- grant (ON CONFLICT DO NOTHING) and only adds one more version bump per company, so it is idempotent
-- in effect.

BEGIN;

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)
SELECT caps.capability_code, mm.id, 'VIEW', true, true
FROM (VALUES ('CAP_STORES_LOGISTICS_DO'), ('CAP_PROC_ACCOUNTS')) AS caps(capability_code)
JOIN acl.menu_master mm ON mm.menu_code = 'PROC_CSN_TRACKER'
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
        SELECT 1
        FROM erp_acl.work_contexts wc
        JOIN acl.work_context_capabilities wcc ON wcc.work_context_id = wc.work_context_id
        WHERE wc.company_id = av.company_id
          AND wcc.capability_code IN ('CAP_STORES_LOGISTICS_DO', 'CAP_PROC_ACCOUNTS')
      )
    FOR UPDATE
  LOOP
    INSERT INTO acl.acl_versions (company_id, version_number, description, is_active, created_by)
    VALUES (
      current_version.company_id,
      current_version.version_number + 1,
      'CSN Tracker: view-only for Stores/Logistics and Accounts work contexts',
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

-- Verification: every user sitting in a work context that carries either capability can now VIEW the
-- tracker (and nothing here granted them anything more).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM erp_acl.user_work_contexts uwc
    JOIN acl.work_context_capabilities wcc ON wcc.work_context_id = uwc.work_context_id
      AND wcc.capability_code IN ('CAP_STORES_LOGISTICS_DO', 'CAP_PROC_ACCOUNTS')
    JOIN acl.acl_versions av ON av.company_id = uwc.company_id AND av.is_active
    JOIN erp_acl.user_roles ur ON ur.auth_user_id = uwc.auth_user_id
    JOIN acl.role_capabilities rc ON rc.role_code = ur.role_code AND rc.capability_code = wcc.capability_code
    WHERE NOT EXISTS (
      SELECT 1 FROM acl.precomputed_acl_view pav
      WHERE pav.acl_version_id = av.acl_version_id
        AND pav.auth_user_id = uwc.auth_user_id
        AND pav.company_id = uwc.company_id
        AND pav.work_context_id = uwc.work_context_id
        AND pav.resource_code = 'PROC_CSN_TRACKER'
        AND pav.action_code = 'VIEW'
        AND pav.decision = 'ALLOW'
    )
    -- An explicit per-user DENY override is deliberate and must keep winning; this grant never
    -- touches it (prod: 5 L3_MANAGER users, one per company, are denied the tracker on purpose).
    AND NOT EXISTS (
      SELECT 1 FROM acl.precomputed_acl_view pav
      WHERE pav.acl_version_id = av.acl_version_id
        AND pav.auth_user_id = uwc.auth_user_id
        AND pav.company_id = uwc.company_id
        AND pav.work_context_id = uwc.work_context_id
        AND pav.resource_code = 'PROC_CSN_TRACKER'
        AND pav.action_code = 'VIEW'
        AND pav.decision_reason = 'USER_OVERRIDE_DENY'
    )
  ) THEN
    RAISE EXCEPTION 'CSN Tracker view-only ACL verification failed';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
