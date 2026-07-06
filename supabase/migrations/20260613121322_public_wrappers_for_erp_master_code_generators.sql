-- Public wrappers so serviceRoleClient.rpc() can call erp_master code generators.
-- PostgREST does not expose erp_master schema RPCs directly (same issue as erp_menu).

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
