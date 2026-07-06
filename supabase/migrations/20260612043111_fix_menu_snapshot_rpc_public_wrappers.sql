-- Public schema wrappers so PostgREST can call erp_menu functions via standard RPC
-- erp_menu schema is not exposed via PostgREST; public schema always is.
CREATE OR REPLACE FUNCTION public.rebuild_sa_menu_snapshot(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog','public','erp_menu' AS $$
BEGIN
  PERFORM erp_menu.generate_menu_snapshot(p_user_id, NULL, 'SA');
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_acl_menu_snapshot(
  p_user_id uuid,
  p_company_id uuid,
  p_work_context_id uuid
)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog','public','erp_menu' AS $$
BEGIN
  PERFORM erp_menu.generate_menu_snapshot(p_user_id, p_company_id, p_work_context_id, 'ACL');
END;
$$;

GRANT EXECUTE ON FUNCTION public.rebuild_sa_menu_snapshot(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rebuild_acl_menu_snapshot(uuid, uuid, uuid) TO authenticated, service_role;
