-- Supabase/PostgREST's production update-safety guard rejects an UPDATE with
-- no predicate, including an UPDATE of an ON COMMIT DROP temporary table.
-- The historical operations RPC must classify every parsed row, so the
-- predicate is deliberately explicit rather than disabling the safety guard.
--
-- This migration patches the already-deployed 20261015180100 function in
-- place. It fails closed if that exact statement is absent.
DO $do$
DECLARE
  v_before text;
  v_after text;
BEGIN
  SELECT pg_get_functiondef('public.import_historical_operations(jsonb, uuid, boolean)'::regprocedure)
    INTO v_before;

  v_after := regexp_replace(
    v_before,
    '(?s)(UPDATE ho_r r SET storable = \(r.row_no IS NOT NULL AND r.sku IS NOT NULL\),.*?ELSE ''VALIDATED'' END)(;)',
    E'\\1\n  WHERE true\\2'
  );

  IF v_after = v_before OR position('UPDATE ho_r r SET storable' IN v_after) = 0
     OR position('ELSE ''VALIDATED'' END' || chr(10) || '  WHERE true;' IN v_after) = 0 THEN
    RAISE EXCEPTION 'HISTORY_IMPORT_UPDATE_SAFETY_PATCH_NOT_APPLIED';
  END IF;

  EXECUTE v_after;
END
$do$;
