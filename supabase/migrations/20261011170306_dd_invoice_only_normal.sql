-- This migration intentionally has one top-level command: the deployed
-- Supabase CLI sends each migration through a prepared statement.
DO $block$
DECLARE v_definition text;
BEGIN
  SELECT pg_get_functiondef('erp_procurement.create_vdc_invoice_only_atomic(jsonb)'::regprocedure)
    INTO v_definition;
  v_definition := regexp_replace(v_definition, E'\\s+AND\\s+is_bulk_uploaded\\s*=\\s*true', '', 'g');
  EXECUTE v_definition;
END;
$block$;
