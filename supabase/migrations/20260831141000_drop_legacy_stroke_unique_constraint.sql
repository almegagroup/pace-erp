-- Older environments can carry the original unnamed three-column uniqueness
-- constraint under a generated name. Remove it by definition, not by name, so
-- a stroke revision may exist independently for each shareable PO type.
DO $$
DECLARE
  legacy_constraint_name text;
BEGIN
  FOR legacy_constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'erp_production.stroke_master'::regclass
      AND con.contype = 'u'
      AND pg_get_constraintdef(con.oid) = 'UNIQUE (company_id, prodshade_material_id, stroke_number)'
  LOOP
    EXECUTE format('ALTER TABLE erp_production.stroke_master DROP CONSTRAINT %I', legacy_constraint_name);
  END LOOP;
END;
$$;
