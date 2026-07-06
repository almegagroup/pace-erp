-- public.generate_customer_code() was never created (every other
-- erp_master code-generator has a public wrapper — see
-- 20260613121322_public_wrappers_for_erp_master_code_generators.sql and
-- 20260619060000_fix_vendor_code_where_clause.sql). PostgREST's RPC
-- lookup for serviceRoleClient.rpc("generate_customer_code") therefore
-- always 404'd (PGRST202), so Customer creation never worked even before
-- today's session touched it.

CREATE OR REPLACE FUNCTION public.generate_customer_code()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER SET search_path = erp_master, public
AS $$ SELECT erp_master.generate_customer_code(); $$;

GRANT EXECUTE ON FUNCTION public.generate_customer_code() TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
