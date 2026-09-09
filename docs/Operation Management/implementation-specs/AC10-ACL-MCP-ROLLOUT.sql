-- R-04: operational MCP SQL; run separately per environment, outside migration history.
-- Already executed during AC10 rollout on 2026-09-09. Do not rerun just for cleanup.
-- Requires CAP_ACC_RECO_DATA grants and the AC10 function correction to be present.
BEGIN;
-- AC10: independent exact-role and Accounts-context grants.
-- Existing shared capability intersection/inheritance and deny precedence are retained.
CREATE TEMP TABLE ac10_before ON COMMIT DROP AS
SELECT p.auth_user_id,p.company_id,p.work_context_id,p.resource_code,p.action_code,p.decision,p.decision_reason,p.menu_visible
FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING(acl_version_id)
WHERE v.is_active AND p.resource_code <> 'ACC_RECO_DATA';
CREATE TEMP TABLE ac10_old_versions ON COMMIT DROP AS
SELECT * FROM acl.acl_versions WHERE is_active;

-- Capture a fresh version, never re-capture frozen source.
DO $rollout$
DECLARE v record; new_id uuid; next_number integer; u record;
BEGIN
  FOR v IN SELECT * FROM ac10_old_versions ORDER BY company_id LOOP
    SELECT COALESCE(MAX(version_number),0)+1 INTO next_number
      FROM acl.acl_versions WHERE company_id=v.company_id;
    INSERT INTO acl.acl_versions(company_id,version_number,description,is_active,created_by)
    VALUES(v.company_id,next_number,'AC10 exact role OR Accounts context: verified ACL correction',false,v.created_by)
    RETURNING acl_version_id INTO new_id;
    PERFORM acl.capture_acl_version_source(new_id,v.company_id,v.created_by);
    PERFORM acl.generate_acl_snapshot(new_id,v.company_id);
    UPDATE acl.acl_versions SET is_active=false WHERE acl_version_id=v.acl_version_id;
    UPDATE acl.acl_versions SET is_active=true WHERE acl_version_id=new_id;
    FOR u IN SELECT DISTINCT auth_user_id,company_id,work_context_id
      FROM erp_acl.user_work_contexts WHERE company_id=v.company_id LOOP
      PERFORM public.rebuild_acl_menu_snapshot(u.auth_user_id,u.company_id,u.work_context_id);
    END LOOP;
  END LOOP;
END $rollout$;
DO $verify$
BEGIN
  IF EXISTS (
    (SELECT * FROM ac10_before EXCEPT
      SELECT p.auth_user_id,p.company_id,p.work_context_id,p.resource_code,p.action_code,p.decision,p.decision_reason,p.menu_visible
      FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING(acl_version_id)
      WHERE v.is_active AND p.resource_code <> 'ACC_RECO_DATA')
    UNION ALL
    (SELECT p.auth_user_id,p.company_id,p.work_context_id,p.resource_code,p.action_code,p.decision,p.decision_reason,p.menu_visible
      FROM acl.precomputed_acl_view p JOIN acl.acl_versions v USING(acl_version_id)
      WHERE v.is_active AND p.resource_code <> 'ACC_RECO_DATA'
      EXCEPT SELECT * FROM ac10_before)
  ) THEN RAISE EXCEPTION 'AC10 rollout would change unrelated ACL decisions'; END IF;
  IF EXISTS (
    SELECT 1 FROM erp_acl.user_work_contexts u
    JOIN erp_acl.work_contexts w USING(work_context_id)
    JOIN erp_map.user_companies uc ON uc.auth_user_id=u.auth_user_id AND uc.company_id=u.company_id
    JOIN erp_acl.user_roles r ON r.auth_user_id=u.auth_user_id
    JOIN acl.acl_versions v ON v.company_id=u.company_id AND v.is_active
    LEFT JOIN acl.precomputed_acl_view p ON p.acl_version_id=v.acl_version_id
      AND p.auth_user_id=u.auth_user_id AND p.company_id=u.company_id AND p.work_context_id=u.work_context_id
      AND p.resource_code='ACC_RECO_DATA' AND p.action_code='VIEW'
    WHERE w.is_active AND r.role_code NOT IN ('SUPER_ADMIN','GLOBAL_ADMIN','SA','GA')
      AND ((r.role_code IN ('DIRECTOR','L3_MANAGER','L1_AUDITOR','L2_AUDITOR') OR w.work_context_name='ACCOUNTS')
        IS DISTINCT FROM COALESCE(p.decision='ALLOW',false))
  ) THEN RAISE EXCEPTION 'AC10 role/context access matrix failed'; END IF;
END $verify$;


COMMIT;
