/*
 * File-ID: 12.10a
 * File-Path: supabase/migrations/20260808194500_fix_material_pace_code_sequence_drift.sql
 * Gate: 12
 * Phase: 12
 * Domain: MASTER
 * Purpose: Make material PACE code generation self-healing against sequence drift caused by historical direct inserts.
 * Authority: Backend
 */

BEGIN;

CREATE OR REPLACE FUNCTION erp_master.generate_material_pace_code(
  p_material_type text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_seq           erp_master.material_code_sequence%ROWTYPE;
  v_existing_max  int;
  v_next          int;
BEGIN
  SELECT *
  INTO v_seq
  FROM erp_master.material_code_sequence
  WHERE material_type = p_material_type
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_MATERIAL_TYPE: %', p_material_type;
  END IF;

  SELECT COALESCE(
    MAX(NULLIF(regexp_replace(pace_code, '\D', '', 'g'), '')::int),
    0
  )
  INTO v_existing_max
  FROM erp_master.material_master
  WHERE material_type = p_material_type
    AND pace_code LIKE v_seq.prefix || '%';

  v_next := GREATEST(v_seq.last_number, v_existing_max) + 1;

  UPDATE erp_master.material_code_sequence
  SET last_number = v_next
  WHERE material_type = p_material_type;

  RETURN v_seq.prefix || lpad(v_next::text, v_seq.padding, '0');
END;
$$;

UPDATE erp_master.material_code_sequence seq
SET last_number = GREATEST(
  seq.last_number,
  COALESCE((
    SELECT MAX(NULLIF(regexp_replace(mat.pace_code, '\D', '', 'g'), '')::int)
    FROM erp_master.material_master mat
    WHERE mat.material_type = seq.material_type
      AND mat.pace_code LIKE seq.prefix || '%'
  ), 0)
);

COMMIT;
