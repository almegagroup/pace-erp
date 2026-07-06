-- Fix: public.generate_vendor_code() was unreachable via PostgREST RPC.
-- Root cause: SET search_path = '' causes PostgREST to skip the function during
-- schema introspection. Recreate without that option, inline the logic.

CREATE OR REPLACE FUNCTION public.generate_vendor_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code text;
BEGIN
  UPDATE erp_master.vendor_code_sequence
  SET last_number = last_number + 1
  RETURNING 'V-' || lpad(last_number::text, 5, '0') INTO v_code;
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_vendor_code()
  TO service_role, authenticated, anon, postgres;

NOTIFY pgrst, 'reload schema';
