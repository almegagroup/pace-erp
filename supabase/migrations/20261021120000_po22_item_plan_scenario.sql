/*
 * Migration: 20261021120000_po22_item_plan_scenario
 * Purpose:   PO22 P4 (owner 2026-10-20) — the user's changes to the Engine + AI plan.
 *            Per company × selected item: lots the user fixed (added / changed an engine or AI
 *            lot: material, plant date, qty, vendor). The engine plans only what is still needed
 *            around them. Append-only versions, so every change is kept (plan versions).
 *            Planning only — never creates a PO, CSN or stock posting.
 *
 *   1. mts_item_plan_scenario — versioned; overrides jsonb = { manual_lots: [...] }.
 *   2. save_mts_item_plan_scenario() — atomic save of a new version.
 *
 * After applying: NOTIFY pgrst, 'reload schema'; run migration-integrity-check.
 */

BEGIN;

CREATE TABLE erp_planning.mts_item_plan_scenario (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES erp_master.companies(id),
  material_id  uuid NOT NULL REFERENCES erp_master.material_master(id),
  version_no   integer NOT NULL CHECK (version_no >= 1),
  is_current   boolean NOT NULL DEFAULT true,
  overrides    jsonb NOT NULL DEFAULT '{"manual_lots": []}'::jsonb CHECK (jsonb_typeof(overrides -> 'manual_lots') = 'array'),
  source       text NOT NULL DEFAULT 'USER' CHECK (source IN ('USER', 'AI_APPLIED')),
  note         text,
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_planning.mts_item_plan_scenario IS
  'PO22: user-fixed lots for one item / family plan (Engine + AI plan edits). Append-only versions; planning only.';

CREATE UNIQUE INDEX ux_mts_item_plan_scenario_current
  ON erp_planning.mts_item_plan_scenario (company_id, material_id) WHERE is_current;

CREATE TRIGGER trg_mts_item_plan_scenario_append_only
  BEFORE UPDATE OR DELETE ON erp_planning.mts_item_plan_scenario
  FOR EACH ROW EXECUTE FUNCTION erp_planning.guard_append_only();

CREATE OR REPLACE FUNCTION erp_planning.save_mts_item_plan_scenario(
  p_company_id  uuid,
  p_material_id uuid,
  p_actor       uuid,
  p_overrides   jsonb,
  p_source      text,
  p_note        text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_current erp_planning.mts_item_plan_scenario%ROWTYPE;
  v_id      uuid;
BEGIN
  IF p_company_id IS NULL OR p_material_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'MTS_SCENARIO_INVALID_INPUT: company, material and actor are required';
  END IF;
  IF p_overrides IS NULL OR jsonb_typeof(p_overrides -> 'manual_lots') <> 'array' THEN
    RAISE EXCEPTION 'MTS_SCENARIO_INVALID_INPUT: overrides.manual_lots must be an array';
  END IF;
  IF jsonb_array_length(p_overrides -> 'manual_lots') > 200 THEN
    RAISE EXCEPTION 'MTS_SCENARIO_TOO_MANY_LOTS: at most 200 lots';
  END IF;

  SELECT * INTO v_current FROM erp_planning.mts_item_plan_scenario
  WHERE company_id = p_company_id AND material_id = p_material_id AND is_current
  FOR UPDATE;
  IF v_current.id IS NOT NULL THEN
    UPDATE erp_planning.mts_item_plan_scenario SET is_current = false WHERE id = v_current.id;
  END IF;
  INSERT INTO erp_planning.mts_item_plan_scenario (company_id, material_id, version_no, is_current, overrides, source, note, created_by)
  VALUES (p_company_id, p_material_id, coalesce(v_current.version_no, 0) + 1, true, p_overrides,
          coalesce(nullif(p_source, ''), 'USER'), nullif(btrim(coalesce(p_note, '')), ''), p_actor)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'version_no', coalesce(v_current.version_no, 0) + 1);
END;
$$;

ALTER TABLE erp_planning.mts_item_plan_scenario ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON erp_planning.mts_item_plan_scenario TO service_role;
REVOKE ALL ON FUNCTION erp_planning.save_mts_item_plan_scenario(uuid, uuid, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.save_mts_item_plan_scenario(uuid, uuid, uuid, jsonb, text, text) TO service_role;

COMMIT;
