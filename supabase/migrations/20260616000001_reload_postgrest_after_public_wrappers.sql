-- Recreate public wrappers for erp_master code generators (idempotent).
-- Includes pg_notify so supabase db push reloads PostgREST automatically.
-- MCP apply_migration goes through PgBouncer which blocks NOTIFY;
-- supabase db push uses a direct connection so NOTIFY reaches PostgREST.

CREATE OR REPLACE FUNCTION public.generate_payment_terms_code()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER SET search_path = erp_master, public
AS $$ SELECT erp_master.generate_payment_terms_code(); $$;

CREATE OR REPLACE FUNCTION public.generate_port_code()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER SET search_path = erp_master, public
AS $$ SELECT erp_master.generate_port_code(); $$;

CREATE OR REPLACE FUNCTION public.generate_transporter_code()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER SET search_path = erp_master, public
AS $$ SELECT erp_master.generate_transporter_code(); $$;

CREATE OR REPLACE FUNCTION public.generate_cha_code()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER SET search_path = erp_master, public
AS $$ SELECT erp_master.generate_cha_code(); $$;

CREATE OR REPLACE FUNCTION public.generate_material_category_code()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER SET search_path = erp_master, public
AS $$ SELECT erp_master.generate_material_category_code(); $$;

GRANT EXECUTE ON FUNCTION public.generate_payment_terms_code() TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_port_code() TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_transporter_code() TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_cha_code() TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_material_category_code() TO service_role;

-- Signal PostgREST to reload schema cache so new functions become accessible via RPC.
SELECT pg_notify('pgrst', 'reload schema');
