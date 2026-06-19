-- Fix: UPDATE requires a WHERE clause (PostgREST/pg safety rule).
-- Add WHERE id = 1 since vendor_code_sequence has exactly one row.

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
  WHERE id = 1
  RETURNING 'V-' || lpad(last_number::text, 5, '0') INTO v_code;
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_vendor_code()
  TO service_role, authenticated, anon, postgres;

NOTIFY pgrst, 'reload schema';
