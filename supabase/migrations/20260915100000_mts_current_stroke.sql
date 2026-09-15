BEGIN;

-- MTS "Current Stroke" — which Stroke Number a given (company, Prodshade) is
-- currently defaulting to for MTS production. Deliberately NOT the same
-- concept as stroke_po_type_applicability.is_active (which tracks which
-- REVISION of one stroke_number is current) — this tracks which of possibly
-- several DIFFERENT stroke_numbers for the same Prodshade is production's
-- default. MTS-only; MTO/HPS/MTEST are untouched by this table.
CREATE TABLE IF NOT EXISTS erp_production.mts_current_stroke (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES erp_master.companies(id),
  prodshade_material_id   UUID NOT NULL REFERENCES erp_master.material_master(id),
  stroke_number           TEXT NOT NULL,
  set_by                  UUID,
  set_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_by         UUID,
  UNIQUE (company_id, prodshade_material_id)
);

GRANT ALL ON TABLE erp_production.mts_current_stroke TO service_role;

-- Idempotent, safe to call after ANY stroke status change (approve,
-- deactivate, revert-to-draft) for a given (company, prodshade). Rules:
--   - if the existing pick is still APPROVED+available, leave it untouched
--     (the system never silently re-picks once a Current Stroke is set)
--   - if the pick is missing/no-longer-available and exactly ONE approved
--     MTS stroke_number remains for this Prodshade, auto-select it
--   - otherwise (zero or 2+ remaining), clear the pick — a human must
--     choose manually via the Current Stroke drawer
CREATE OR REPLACE FUNCTION erp_production.recompute_mts_current_stroke(
  p_company_id UUID,
  p_prodshade_material_id UUID,
  p_actor UUID
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_stroke_number TEXT;
  v_approved_numbers TEXT[];
BEGIN
  SELECT stroke_number INTO v_current_stroke_number
  FROM erp_production.mts_current_stroke
  WHERE company_id = p_company_id AND prodshade_material_id = p_prodshade_material_id;

  SELECT array_agg(DISTINCT stroke_number) INTO v_approved_numbers
  FROM erp_production.stroke_master
  WHERE company_id = p_company_id
    AND prodshade_material_id = p_prodshade_material_id
    AND po_type = 'MTS'
    AND material_type = 'SFG'
    AND status = 'APPROVED';

  IF v_current_stroke_number IS NOT NULL
     AND v_current_stroke_number = ANY (COALESCE(v_approved_numbers, ARRAY[]::TEXT[])) THEN
    RETURN;
  END IF;

  IF COALESCE(array_length(v_approved_numbers, 1), 0) = 1 THEN
    INSERT INTO erp_production.mts_current_stroke (
      company_id, prodshade_material_id, stroke_number, set_by, last_updated_by
    ) VALUES (
      p_company_id, p_prodshade_material_id, v_approved_numbers[1], p_actor, p_actor
    )
    ON CONFLICT (company_id, prodshade_material_id) DO UPDATE
      SET stroke_number = EXCLUDED.stroke_number,
          last_updated_at = now(),
          last_updated_by = p_actor;
  ELSE
    DELETE FROM erp_production.mts_current_stroke
    WHERE company_id = p_company_id AND prodshade_material_id = p_prodshade_material_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION erp_production.recompute_mts_current_stroke(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_production.recompute_mts_current_stroke(UUID, UUID, UUID) TO service_role;

COMMIT;
