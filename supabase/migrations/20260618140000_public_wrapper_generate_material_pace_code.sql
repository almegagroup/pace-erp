-- Public wrapper for erp_master.generate_material_pace_code.
-- serviceRoleClient.rpc() only reaches the public schema via PostgREST.
-- erp_master schema is not exposed for RPC, so calls silently failed.

CREATE OR REPLACE FUNCTION public.generate_material_pace_code(p_material_type text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT erp_master.generate_material_pace_code(p_material_type);
$$;
