BEGIN;

ALTER TABLE erp_production.stroke_po_type_applicability
  ADD COLUMN IF NOT EXISTS default_storage_location_id uuid
  REFERENCES erp_inventory.storage_location_master(id);

-- Every original stroke keeps its own configured SFG location for its own type.
UPDATE erp_production.stroke_po_type_applicability applicability
SET default_storage_location_id = stroke.default_storage_location_id
FROM erp_production.stroke_master stroke
WHERE stroke.id = applicability.stroke_master_id
  AND applicability.default_storage_location_id IS NULL
  AND applicability.target_po_type = stroke.po_type;

-- Shared production types use the company's shop-floor S location, never the
-- source MTEST lab location. Target MTEST continues to use its own L003 source.
UPDATE erp_production.stroke_po_type_applicability applicability
SET default_storage_location_id = target_sloc.id
FROM erp_production.stroke_master stroke
JOIN LATERAL (
  SELECT sl.id
  FROM erp_inventory.storage_location_plant_map map
  JOIN erp_inventory.storage_location_master sl ON sl.id = map.storage_location_id
  WHERE map.company_id = stroke.company_id
    AND map.active = true
    AND sl.active = true
    AND sl.code LIKE 'S%'
  ORDER BY sl.code
  LIMIT 1
) target_sloc ON true
WHERE stroke.id = applicability.stroke_master_id
  AND applicability.default_storage_location_id IS NULL
  AND applicability.target_po_type IN ('MTO', 'HPS', 'MTS');

CREATE OR REPLACE FUNCTION erp_production.sync_stroke_self_applicability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.material_type = 'SFG' AND NEW.po_type IN ('MTO', 'HPS', 'MTS', 'MTEST') THEN
    INSERT INTO erp_production.stroke_po_type_applicability (
      stroke_master_id, target_po_type, default_storage_location_id,
      is_active, created_by, last_updated_by
    ) VALUES (
      NEW.id, NEW.po_type, NEW.default_storage_location_id,
      NEW.status = 'APPROVED', NEW.created_by, NEW.last_updated_by
    ) ON CONFLICT (stroke_master_id, target_po_type) DO UPDATE
      SET default_storage_location_id = EXCLUDED.default_storage_location_id,
          is_active = EXCLUDED.is_active,
          last_updated_at = now(),
          last_updated_by = EXCLUDED.last_updated_by;
  END IF;
  RETURN NEW;
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
  v_target_sloc_id uuid;
BEGIN
  SELECT * INTO v_source FROM erp_production.stroke_master WHERE id = p_source_stroke_master_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROD_STROKE_NOT_FOUND'; END IF;
  IF v_source.status <> 'APPROVED' OR v_source.material_type <> 'SFG' THEN RAISE EXCEPTION 'PROD_STROKE_SHARE_SOURCE_NOT_ACTIVE'; END IF;
  IF v_source.po_type NOT IN ('MTO', 'HPS', 'MTS', 'MTEST') OR p_to_po_type NOT IN ('MTO', 'HPS', 'MTS', 'MTEST') OR p_to_po_type = v_source.po_type THEN
    RAISE EXCEPTION 'PROD_STROKE_SHARE_TYPE_INVALID';
  END IF;

  IF p_to_po_type = 'MTEST' THEN
    SELECT id INTO v_target_sloc_id
    FROM erp_inventory.storage_location_master
    WHERE code = 'L003' AND active = true
    LIMIT 1;
  ELSE
    SELECT sl.id INTO v_target_sloc_id
    FROM erp_inventory.storage_location_plant_map map
    JOIN erp_inventory.storage_location_master sl ON sl.id = map.storage_location_id
    WHERE map.company_id = v_source.company_id
      AND map.active = true
      AND sl.active = true
      AND sl.code LIKE 'S%'
    ORDER BY sl.code
    LIMIT 1;
  END IF;
  IF v_target_sloc_id IS NULL THEN RAISE EXCEPTION 'PROD_STROKE_SHARE_TARGET_SLOC_NOT_FOUND'; END IF;

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
    ) THEN RAISE EXCEPTION 'PROD_STROKE_SHARE_TARGET_ALREADY_ACTIVE'; END IF;

    INSERT INTO erp_production.stroke_po_type_applicability (
      stroke_master_id, target_po_type, default_storage_location_id,
      is_active, created_by, last_updated_by
    ) VALUES (v_source.id, p_to_po_type, v_target_sloc_id, true, p_actor, p_actor)
    ON CONFLICT (stroke_master_id, target_po_type) DO UPDATE
      SET default_storage_location_id = EXCLUDED.default_storage_location_id,
          is_active = true, last_updated_at = now(), last_updated_by = p_actor;

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
    v_target_sloc_id, v_source.communication_date, v_source.communication_type,
    v_source.communicator_name, v_source.communication_reference, v_revision_no, v_source.id,
    'DRAFT', p_actor, now(), now(), p_actor
  ) RETURNING id INTO v_target_id;

  INSERT INTO erp_production.stroke_line (
    stroke_master_id, material_id, alternate_material_id, line_material_type, material_group_id,
    default_storage_location_id, dosage_pct, display_order
  )
  SELECT v_target_id, material_id, alternate_material_id, line_material_type, material_group_id,
    default_storage_location_id, dosage_pct, display_order
  FROM erp_production.stroke_line WHERE stroke_master_id = v_source.id;

  INSERT INTO erp_production.stroke_share_event (
    source_stroke_master_id, target_stroke_master_id, from_po_type, to_po_type,
    consider_formulation_changes, shared_by
  ) VALUES (v_source.id, v_target_id, v_source.po_type, p_to_po_type, true, p_actor);
  RETURN QUERY SELECT v_target_id, true;
END;
$$;

COMMIT;
