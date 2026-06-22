-- All these erp_master.generate_*_code() functions did
-- `UPDATE ... SET last_number = last_number + 1 RETURNING ...` with no
-- WHERE clause. supautils' safe-update guard rejects unqualified
-- UPDATE/DELETE for the service_role connection PostgREST uses, which
-- surfaced as "UPDATE requires a WHERE clause" (visible in Postgres logs)
-- whenever these were called through the API rather than a direct SQL
-- session — e.g. Customer/Parent Customer creation 500ing while a few
-- other code generators had happened to run via paths that didn't trip
-- the guard. Each sequence table is a single-row counter, so qualifying
-- on its primary key is always correct and harmless.

CREATE OR REPLACE FUNCTION erp_master.generate_cha_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.cha_code_sequence
  SET last_number = last_number + 1
  WHERE id = 1
  RETURNING last_number INTO v_next;
  RETURN 'CHA-' || lpad(v_next::text, 4, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION erp_master.generate_customer_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.customer_code_sequence
  SET last_number = last_number + 1
  WHERE id = 1
  RETURNING last_number INTO v_next;
  RETURN 'C-' || lpad(v_next::text, 5, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION erp_master.generate_material_category_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.material_category_code_sequence
  SET last_number = last_number + 1
  WHERE id = 1
  RETURNING last_number INTO v_next;
  RETURN 'MC-' || lpad(v_next::text, 4, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION erp_master.generate_parent_customer_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.parent_customer_code_sequence
  SET last_number = last_number + 1
  WHERE id = true
  RETURNING last_number INTO v_next;
  RETURN 'PC-' || lpad(v_next::text, 5, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION erp_master.generate_payment_terms_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.payment_terms_code_sequence
  SET last_number = last_number + 1
  WHERE id = 1
  RETURNING last_number INTO v_next;
  RETURN 'PT-' || lpad(v_next::text, 3, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION erp_master.generate_port_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.port_code_sequence
  SET last_number = last_number + 1
  WHERE id = 1
  RETURNING last_number INTO v_next;
  RETURN 'PORT-' || lpad(v_next::text, 4, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION erp_master.generate_transporter_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.transporter_code_sequence
  SET last_number = last_number + 1
  WHERE id = 1
  RETURNING last_number INTO v_next;
  RETURN 'TR-' || lpad(v_next::text, 5, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION erp_master.generate_vendor_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.vendor_code_sequence
  SET last_number = last_number + 1
  WHERE id = 1
  RETURNING last_number INTO v_next;
  RETURN 'V-' || lpad(v_next::text, 5, '0');
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
