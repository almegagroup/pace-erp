/*
 * AC06 monthly output applicability.
 * A parent SLOC Group owns the input-rate scope, so the mapping is stored
 * against that group (not a child Costing Group) even though it is edited
 * from the Costing Group Setup workspace.
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_production.ac06_month_fg_type_scope (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_id uuid NOT NULL REFERENCES erp_production.ac06_month(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  source_sloc_group_id uuid NOT NULL REFERENCES erp_production.ac06_sloc_group(id) ON DELETE RESTRICT,
  line_material_type text NOT NULL CHECK (line_material_type IN ('FG', 'SFG')),
  fg_type text NOT NULL CHECK (fg_type IN ('MTO', 'HPS', 'MTEST', 'MTS')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  last_updated_at timestamptz,
  last_updated_by uuid,
  UNIQUE (month_id, source_sloc_group_id, line_material_type, fg_type),
  UNIQUE (month_id, line_material_type, fg_type)
);

CREATE INDEX IF NOT EXISTS idx_ac06_month_fg_type_scope_lookup
  ON erp_production.ac06_month_fg_type_scope (company_id, month_id, line_material_type, fg_type);

CREATE TABLE IF NOT EXISTS erp_production.ac06_month_archive_fg_type_scope (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES erp_production.ac06_month_archive(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  source_sloc_group_id_snapshot uuid,
  source_sloc_group_name_snapshot text NOT NULL,
  line_material_type text NOT NULL CHECK (line_material_type IN ('FG', 'SFG')),
  fg_type text NOT NULL CHECK (fg_type IN ('MTO', 'HPS', 'MTEST', 'MTS')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  last_updated_at timestamptz,
  last_updated_by uuid,
  UNIQUE (archive_id, line_material_type, fg_type)
);

CREATE INDEX IF NOT EXISTS idx_ac06_archive_fg_type_scope_lookup
  ON erp_production.ac06_month_archive_fg_type_scope (company_id, archive_id, line_material_type, fg_type);

GRANT ALL ON erp_production.ac06_month_fg_type_scope TO service_role;
GRANT ALL ON erp_production.ac06_month_archive_fg_type_scope TO service_role;

CREATE OR REPLACE FUNCTION erp_production.snapshot_ac06_month_fg_type_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, public
AS $$
BEGIN
  INSERT INTO erp_production.ac06_month_archive_fg_type_scope (
    archive_id, company_id, source_sloc_group_id_snapshot,
    source_sloc_group_name_snapshot, line_material_type, fg_type,
    created_by, last_updated_by
  )
  SELECT NEW.id, scope.company_id, scope.source_sloc_group_id, sloc.group_name,
         scope.line_material_type, scope.fg_type,
         scope.created_by, scope.last_updated_by
  FROM erp_production.ac06_month_fg_type_scope scope
  JOIN erp_production.ac06_sloc_group sloc ON sloc.id = scope.source_sloc_group_id
  WHERE scope.month_id = NEW.source_month_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION erp_production.snapshot_ac06_month_fg_type_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_ac06_archive_fg_type_scope ON erp_production.ac06_month_archive;
CREATE TRIGGER trg_ac06_archive_fg_type_scope
AFTER INSERT ON erp_production.ac06_month_archive
FOR EACH ROW EXECUTE FUNCTION erp_production.snapshot_ac06_month_fg_type_scope();

COMMIT;
