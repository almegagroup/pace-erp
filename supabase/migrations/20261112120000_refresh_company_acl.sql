-- One call to make a company's menus follow its current module/project setup.
--
-- Turning a module on/off (Company Modules) or mapping/unmapping a project only edits live tables. The menu a user
-- sees comes from the ACL snapshot, which stays stale until a NEW acl_version is captured + snapshotted (a captured
-- version is immutable -- CLAUDE.md pattern #4). This function does that whole sequence for one company:
-- new version -> capture -> generate -> activate -> rebuild every user's menu snapshot.
-- Same sequence as 20261103180000_csn_tracker_view_for_stores_accounts.sql, now reusable.

CREATE OR REPLACE FUNCTION acl.refresh_company_acl(p_company_id uuid, p_description text DEFAULT 'Company module/project change')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = acl, erp_acl, public
AS $$
DECLARE
  cur record;
  next_id uuid;
  u record;
  rebuilt integer := 0;
BEGIN
  SELECT av.acl_version_id, av.company_id, av.version_number, av.created_by
    INTO cur
  FROM acl.acl_versions av
  WHERE av.company_id = p_company_id AND av.is_active
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0; -- company has no active ACL version yet: nothing to refresh
  END IF;

  INSERT INTO acl.acl_versions (company_id, version_number, description, is_active, created_by)
  VALUES (p_company_id, (SELECT max(version_number) FROM acl.acl_versions WHERE company_id = p_company_id) + 1,
          p_description, false, cur.created_by)
  RETURNING acl_version_id INTO next_id;

  PERFORM acl.capture_acl_version_source(next_id, p_company_id, cur.created_by);
  PERFORM acl.generate_acl_snapshot(next_id, p_company_id);

  UPDATE acl.acl_versions SET is_active = false WHERE acl_version_id = cur.acl_version_id;
  UPDATE acl.acl_versions SET is_active = true WHERE acl_version_id = next_id;

  FOR u IN
    SELECT DISTINCT auth_user_id, company_id, work_context_id
    FROM erp_acl.user_work_contexts
    WHERE company_id = p_company_id
  LOOP
    PERFORM public.rebuild_acl_menu_snapshot(u.auth_user_id, u.company_id, u.work_context_id);
    rebuilt := rebuilt + 1;
  END LOOP;

  RETURN rebuilt;
END;
$$;

-- PostgREST only exposes public: thin wrapper, service role only.
CREATE OR REPLACE FUNCTION public.refresh_company_acl(p_company_id uuid, p_description text DEFAULT 'Company module/project change')
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, acl
AS $$ SELECT acl.refresh_company_acl(p_company_id, p_description); $$;

REVOKE ALL ON FUNCTION acl.refresh_company_acl(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_company_acl(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION acl.refresh_company_acl(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_company_acl(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
