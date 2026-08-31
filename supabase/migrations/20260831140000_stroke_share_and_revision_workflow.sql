BEGIN;

ALTER TABLE erp_production.stroke_master
  ADD COLUMN IF NOT EXISTS revision_no integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_stroke_master_id uuid NULL
    REFERENCES erp_production.stroke_master(id);

ALTER TABLE erp_production.stroke_master
  DROP CONSTRAINT IF EXISTS stroke_master_company_id_prodshade_material_id_stroke_number_key;

ALTER TABLE erp_production.stroke_master
  DROP CONSTRAINT IF EXISTS stroke_master_company_prodshade_stroke_type_revision_key;

ALTER TABLE erp_production.stroke_master
  ADD CONSTRAINT stroke_master_company_prodshade_stroke_type_revision_key
  UNIQUE (company_id, prodshade_material_id, stroke_number, po_type, revision_no);

CREATE TABLE IF NOT EXISTS erp_production.stroke_po_type_applicability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stroke_master_id uuid NOT NULL REFERENCES erp_production.stroke_master(id) ON DELETE CASCADE,
  target_po_type text NOT NULL CHECK (target_po_type IN ('MTO', 'HPS', 'MTS', 'MTEST')),
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid NULL,
  UNIQUE (stroke_master_id, target_po_type)
);

CREATE INDEX IF NOT EXISTS idx_stroke_po_type_applicability_target
  ON erp_production.stroke_po_type_applicability (target_po_type, is_active, stroke_master_id);

CREATE TABLE IF NOT EXISTS erp_production.stroke_share_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_stroke_master_id uuid NOT NULL REFERENCES erp_production.stroke_master(id),
  target_stroke_master_id uuid NULL REFERENCES erp_production.stroke_master(id),
  from_po_type text NOT NULL CHECK (from_po_type IN ('MTO', 'HPS', 'MTS', 'MTEST')),
  to_po_type text NOT NULL CHECK (to_po_type IN ('MTO', 'HPS', 'MTS', 'MTEST')),
  consider_formulation_changes boolean NOT NULL DEFAULT false,
  shared_by uuid NOT NULL,
  shared_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_po_type <> to_po_type)
);

CREATE OR REPLACE FUNCTION erp_production.sync_stroke_self_applicability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.material_type = 'SFG' AND NEW.po_type IN ('MTO', 'HPS', 'MTS', 'MTEST') THEN
    INSERT INTO erp_production.stroke_po_type_applicability (
      stroke_master_id, target_po_type, is_active, created_by, last_updated_by
    ) VALUES (
      NEW.id, NEW.po_type, NEW.status = 'APPROVED', NEW.created_by, NEW.last_updated_by
    ) ON CONFLICT (stroke_master_id, target_po_type) DO UPDATE
      SET is_active = EXCLUDED.is_active,
          last_updated_at = now(),
          last_updated_by = EXCLUDED.last_updated_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_stroke_self_applicability ON erp_production.stroke_master;
CREATE TRIGGER trg_sync_stroke_self_applicability
AFTER INSERT OR UPDATE OF status, po_type ON erp_production.stroke_master
FOR EACH ROW EXECUTE FUNCTION erp_production.sync_stroke_self_applicability();

INSERT INTO erp_production.stroke_po_type_applicability (
  stroke_master_id, target_po_type, is_active, created_by, last_updated_by
)
SELECT id, po_type, status = 'APPROVED', created_by, last_updated_by
FROM erp_production.stroke_master
WHERE material_type = 'SFG' AND po_type IN ('MTO', 'HPS', 'MTS', 'MTEST')
ON CONFLICT (stroke_master_id, target_po_type) DO NOTHING;

CREATE OR REPLACE FUNCTION erp_production.activate_stroke_po_type(
  p_stroke_master_id uuid,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_stroke erp_production.stroke_master%ROWTYPE;
BEGIN
  SELECT * INTO v_stroke FROM erp_production.stroke_master WHERE id = p_stroke_master_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROD_STROKE_NOT_FOUND'; END IF;
  IF v_stroke.material_type <> 'SFG' OR v_stroke.po_type NOT IN ('MTO', 'HPS', 'MTS', 'MTEST') THEN RETURN; END IF;

  UPDATE erp_production.stroke_po_type_applicability applicability
  SET is_active = false, last_updated_at = now(), last_updated_by = p_actor
  FROM erp_production.stroke_master candidate
  WHERE applicability.stroke_master_id = candidate.id
    AND applicability.target_po_type = v_stroke.po_type
    AND candidate.company_id = v_stroke.company_id
    AND candidate.prodshade_material_id IS NOT DISTINCT FROM v_stroke.prodshade_material_id
    AND candidate.stroke_number = v_stroke.stroke_number
    AND applicability.stroke_master_id <> p_stroke_master_id;

  UPDATE erp_production.stroke_po_type_applicability
  SET is_active = true, last_updated_at = now(), last_updated_by = p_actor
  WHERE stroke_master_id = p_stroke_master_id AND target_po_type = v_stroke.po_type;
END;
$$;

CREATE OR REPLACE FUNCTION erp_production.share_stroke_master(
  p_source_stroke_master_id uuid,
  p_to_po_type text,
  p_consider_formulation_changes boolean,
  p_actor uuid
)
RETURNS TABLE(target_stroke_master_id uuid, created_draft boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_source erp_production.stroke_master%ROWTYPE;
  v_target_id uuid;
  v_revision_no integer;
BEGIN
  SELECT * INTO v_source FROM erp_production.stroke_master WHERE id = p_source_stroke_master_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROD_STROKE_NOT_FOUND'; END IF;
  IF v_source.status <> 'APPROVED' OR v_source.material_type <> 'SFG' THEN RAISE EXCEPTION 'PROD_STROKE_SHARE_SOURCE_NOT_ACTIVE'; END IF;
  IF v_source.po_type NOT IN ('MTO', 'HPS', 'MTS', 'MTEST') OR p_to_po_type NOT IN ('MTO', 'HPS', 'MTS', 'MTEST') OR p_to_po_type = v_source.po_type THEN
    RAISE EXCEPTION 'PROD_STROKE_SHARE_TYPE_INVALID';
  END IF;

  IF NOT p_consider_formulation_changes THEN
    IF EXISTS (
      SELECT 1
      FROM erp_production.stroke_po_type_applicability applicability
      JOIN erp_production.stroke_master candidate ON candidate.id = applicability.stroke_master_id
      WHERE applicability.target_po_type = p_to_po_type
        AND applicability.is_active = true
        AND candidate.company_id = v_source.company_id
        AND candidate.prodshade_material_id IS NOT DISTINCT FROM v_source.prodshade_material_id
        AND candidate.stroke_number = v_source.stroke_number
    ) THEN
      RAISE EXCEPTION 'PROD_STROKE_SHARE_TARGET_ALREADY_ACTIVE';
    END IF;

    INSERT INTO erp_production.stroke_po_type_applicability (
      stroke_master_id, target_po_type, is_active, created_by, last_updated_by
    ) VALUES (v_source.id, p_to_po_type, true, p_actor, p_actor)
    ON CONFLICT (stroke_master_id, target_po_type) DO UPDATE
      SET is_active = true, last_updated_at = now(), last_updated_by = p_actor;

    INSERT INTO erp_production.stroke_share_event (
      source_stroke_master_id, target_stroke_master_id, from_po_type, to_po_type,
      consider_formulation_changes, shared_by
    ) VALUES (v_source.id, v_source.id, v_source.po_type, p_to_po_type, false, p_actor);

    RETURN QUERY SELECT v_source.id, false;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(revision_no), 0) + 1 INTO v_revision_no
  FROM erp_production.stroke_master
  WHERE company_id = v_source.company_id
    AND prodshade_material_id IS NOT DISTINCT FROM v_source.prodshade_material_id
    AND stroke_number = v_source.stroke_number
    AND po_type = p_to_po_type;

  INSERT INTO erp_production.stroke_master (
    company_id, prodshade_material_id, prod_code, shade_code, stroke_number, description,
    material_type, po_type, base_uom_code, conversion_uom_code, conversion_factor,
    default_storage_location_id, communication_date, communication_type, communicator_name,
    communication_reference, revision_no, source_stroke_master_id, status, created_by,
    created_at, last_updated_at, last_updated_by
  ) VALUES (
    v_source.company_id, v_source.prodshade_material_id, v_source.prod_code, v_source.shade_code,
    v_source.stroke_number, v_source.description, v_source.material_type, p_to_po_type,
    v_source.base_uom_code, v_source.conversion_uom_code, v_source.conversion_factor,
    v_source.default_storage_location_id, v_source.communication_date, v_source.communication_type,
    v_source.communicator_name, v_source.communication_reference, v_revision_no, v_source.id,
    'DRAFT', p_actor, now(), now(), p_actor
  ) RETURNING id INTO v_target_id;

  INSERT INTO erp_production.stroke_line (
    stroke_master_id, material_id, alternate_material_id, line_material_type, material_group_id,
    default_storage_location_id, dosage_pct, display_order
  )
  SELECT v_target_id, material_id, alternate_material_id, line_material_type, material_group_id,
    default_storage_location_id, dosage_pct, display_order
  FROM erp_production.stroke_line
  WHERE stroke_master_id = v_source.id;

  INSERT INTO erp_production.stroke_share_event (
    source_stroke_master_id, target_stroke_master_id, from_po_type, to_po_type,
    consider_formulation_changes, shared_by
  ) VALUES (v_source.id, v_target_id, v_source.po_type, p_to_po_type, true, p_actor);

  RETURN QUERY SELECT v_target_id, true;
END;
$$;

COMMIT;
