/*
 * PO22 Family Waterfall W1 — individual effective-dated Desired Max override.
 * Blank remains automatic: Target + the calculated order cycle.  The override
 * is a planning guard only and is append-only with the rest of the policy row.
 */
BEGIN;

ALTER TABLE erp_planning.material_requirement_policy
  ADD COLUMN IF NOT EXISTS desired_max_days_override numeric;

ALTER TABLE erp_planning.material_requirement_policy
  DROP CONSTRAINT IF EXISTS ck_material_requirement_policy_desired_max;
ALTER TABLE erp_planning.material_requirement_policy
  ADD CONSTRAINT ck_material_requirement_policy_desired_max
  CHECK (desired_max_days_override IS NULL OR desired_max_days_override >= 0);

COMMENT ON COLUMN erp_planning.material_requirement_policy.desired_max_days_override IS
  'Optional user-set Desired Max Days. NULL derives Target Coverage Days + calculated order cycle; when set it may not be below Target.';

CREATE OR REPLACE FUNCTION erp_planning.save_material_requirement_policies(
  p_company_id uuid, p_actor uuid, p_rows jsonb, p_source_system text DEFAULT 'ERP_ENTRY'
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, erp_planning, erp_master
AS $$
DECLARE
  v_batch uuid := gen_random_uuid(); v_row jsonb; v_material uuid; v_from date;
  v_target numeric; v_critical numeric; v_desired_max numeric; v_moq numeric;
  v_moq_uom text; v_source text; v_active boolean; v_remarks text; v_rate numeric;
  v_order_uom text; v_base_uom text; v_type text;
  v_current erp_planning.material_requirement_policy%ROWTYPE;
  v_saved integer := 0; v_unchanged integer := 0; v_seen text[] := ARRAY[]::text[]; v_key text;
BEGIN
  IF p_company_id IS NULL OR p_actor IS NULL THEN RAISE EXCEPTION 'MTS_REQ_POLICY_INVALID_INPUT: company and actor are required'; END IF;
  IF p_source_system NOT IN ('ERP_ENTRY', 'LEGACY_GOOGLE_SHEETS') THEN RAISE EXCEPTION 'MTS_REQ_POLICY_INVALID_INPUT: unknown source system %', p_source_system; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN RAISE EXCEPTION 'MTS_REQ_POLICY_NO_ROWS: nothing to save'; END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_material := nullif(v_row->>'material_id', '')::uuid;
    v_from := nullif(v_row->>'effective_from', '')::date;
    v_target := nullif(v_row->>'target_cov_days', '')::numeric;
    v_critical := nullif(v_row->>'critical_cov_days', '')::numeric;
    v_desired_max := nullif(v_row->>'desired_max_days_override', '')::numeric;
    v_moq := nullif(v_row->>'moq_qty', '')::numeric;
    v_moq_uom := nullif(upper(btrim(coalesce(v_row->>'moq_uom_code', ''))), '');
    v_source := upper(coalesce(nullif(v_row->>'moq_source', ''), 'NONE'));
    v_active := coalesce((v_row->>'moq_active')::boolean, false);
    v_remarks := nullif(btrim(coalesce(v_row->>'remarks', '')), '');
    v_rate := nullif(v_row->>'carrying_rate_per_uom', '')::numeric;
    v_order_uom := nullif(upper(btrim(coalesce(v_row->>'order_uom_code', ''))), '');

    IF v_material IS NULL OR v_from IS NULL THEN RAISE EXCEPTION 'MTS_REQ_POLICY_INVALID_INPUT: material and effective date are required'; END IF;
    v_key := v_material::text || '|' || v_from::text;
    IF v_key = ANY (v_seen) THEN RAISE EXCEPTION 'MTS_REQ_POLICY_DUPLICATE_ROW: material % appears twice for effective date %', v_material, v_from; END IF;
    v_seen := array_append(v_seen, v_key);
    SELECT m.base_uom_code, m.material_type INTO v_base_uom, v_type FROM erp_master.material_master m WHERE m.id = v_material;
    IF v_type IS NULL THEN RAISE EXCEPTION 'MTS_REQ_POLICY_MATERIAL_NOT_FOUND: %', v_material; END IF;
    IF v_type NOT IN ('RM', 'PM') THEN RAISE EXCEPTION 'MTS_REQ_POLICY_MATERIAL_TYPE: % is %, only RM / PM materials carry a requirement policy', v_material, v_type; END IF;
    IF (v_target IS NOT NULL AND v_target < 0) OR (v_critical IS NOT NULL AND v_critical < 0) OR (v_desired_max IS NOT NULL AND v_desired_max < 0) OR (v_moq IS NOT NULL AND v_moq < 0) OR (v_rate IS NOT NULL AND v_rate < 0) THEN RAISE EXCEPTION 'MTS_REQ_POLICY_NEGATIVE: values may not be negative (material %)', v_material; END IF;
    IF v_target IS NULL AND v_critical IS NOT NULL THEN RAISE EXCEPTION 'MTS_REQ_POLICY_TARGET_REQUIRED: Critical days need Target days (material %)', v_material; END IF;
    IF v_desired_max IS NOT NULL AND (v_target IS NULL OR v_desired_max < v_target) THEN RAISE EXCEPTION 'MTS_REQ_POLICY_DESIRED_MAX_INVALID: Desired Max needs Target and cannot be below it (material %)', v_material; END IF;
    IF v_target IS NOT NULL AND v_critical IS NULL THEN v_critical := ceil(v_target / 2); END IF;
    IF v_source NOT IN ('VENDOR', 'COMPANY', 'NONE') THEN RAISE EXCEPTION 'MTS_REQ_POLICY_MOQ_SOURCE: % is not VENDOR / COMPANY / NONE', v_source; END IF;
    IF v_source = 'NONE' AND (v_moq IS NOT NULL OR v_active) THEN RAISE EXCEPTION 'MTS_REQ_POLICY_MOQ_SHAPE: MOQ source NONE carries no quantity and cannot be active (material %)', v_material; END IF;
    IF v_moq IS NOT NULL AND v_moq_uom IS NULL THEN RAISE EXCEPTION 'MTS_REQ_POLICY_MOQ_UOM_REQUIRED: MOQ quantity needs a unit (material %)', v_material; END IF;
    IF v_active AND v_moq IS NULL THEN RAISE EXCEPTION 'MTS_REQ_POLICY_MOQ_SHAPE: an active MOQ needs a quantity (material %)', v_material; END IF;
    IF v_moq IS NULL THEN v_moq_uom := NULL; END IF;
    IF v_moq_uom IS NOT NULL AND upper(v_moq_uom) <> upper(v_base_uom) AND NOT (v_moq_uom = 'MT' AND upper(v_base_uom) = 'KG') AND NOT EXISTS (
      SELECT 1 FROM erp_master.material_uom_conversion c WHERE c.material_id = v_material AND coalesce(c.active, true) AND NOT coalesce(c.variable_conversion, false) AND coalesce(c.conversion_factor, 0) > 0 AND ((upper(c.from_uom_code) = v_moq_uom AND upper(c.to_uom_code) = upper(v_base_uom)) OR (upper(c.to_uom_code) = v_moq_uom AND upper(c.from_uom_code) = upper(v_base_uom)))
    ) THEN RAISE EXCEPTION 'MTS_REQ_POLICY_MOQ_UOM_INVALID: % has no verified conversion to base unit % (material %)', v_moq_uom, v_base_uom, v_material; END IF;
    IF v_order_uom IS NOT NULL AND upper(v_order_uom) = upper(v_base_uom) THEN v_order_uom := NULL; END IF;
    IF v_order_uom IS NOT NULL AND NOT (v_order_uom = 'MT' AND upper(v_base_uom) = 'KG') AND NOT EXISTS (
      SELECT 1 FROM erp_master.material_uom_conversion c WHERE c.material_id = v_material AND coalesce(c.active, true) AND NOT coalesce(c.variable_conversion, false) AND coalesce(c.conversion_factor, 0) > 0 AND ((upper(c.from_uom_code) = v_order_uom AND upper(c.to_uom_code) = upper(v_base_uom)) OR (upper(c.to_uom_code) = v_order_uom AND upper(c.from_uom_code) = upper(v_base_uom)))
    ) THEN RAISE EXCEPTION 'MTS_REQ_POLICY_ORDER_UOM_INVALID: % has no verified conversion to base unit % (material %)', v_order_uom, v_base_uom, v_material; END IF;
    IF v_target IS NULL AND v_desired_max IS NULL AND v_moq IS NULL AND v_source = 'NONE' AND v_remarks IS NULL AND v_rate IS NULL AND v_order_uom IS NULL THEN RAISE EXCEPTION 'MTS_REQ_POLICY_EMPTY: nothing set for material %', v_material; END IF;

    SELECT * INTO v_current FROM erp_planning.material_requirement_policy WHERE company_id = p_company_id AND material_id = v_material AND effective_from = v_from AND is_current FOR UPDATE;
    IF v_current.id IS NOT NULL AND v_current.target_cov_days IS NOT DISTINCT FROM v_target AND v_current.critical_cov_days IS NOT DISTINCT FROM v_critical AND v_current.desired_max_days_override IS NOT DISTINCT FROM v_desired_max AND v_current.moq_qty IS NOT DISTINCT FROM v_moq AND v_current.moq_uom_code IS NOT DISTINCT FROM v_moq_uom AND v_current.moq_source = v_source AND v_current.moq_active = v_active AND v_current.remarks IS NOT DISTINCT FROM v_remarks AND v_current.carrying_rate_per_uom IS NOT DISTINCT FROM v_rate AND v_current.order_uom_code IS NOT DISTINCT FROM v_order_uom THEN v_unchanged := v_unchanged + 1; CONTINUE; END IF;
    IF v_current.id IS NOT NULL THEN UPDATE erp_planning.material_requirement_policy SET is_current = false WHERE id = v_current.id; END IF;
    INSERT INTO erp_planning.material_requirement_policy (
      company_id, material_id, effective_from, version_no, is_current, target_cov_days, critical_cov_days, desired_max_days_override, moq_qty, moq_uom_code, moq_source, moq_active, remarks, carrying_rate_per_uom, order_uom_code, source_system, source_ref, save_batch_id, created_by
    ) VALUES (
      p_company_id, v_material, v_from, coalesce(v_current.version_no, 0) + 1, true, v_target, v_critical, v_desired_max, v_moq, v_moq_uom, v_source, v_active, v_remarks, v_rate, v_order_uom, p_source_system, v_row->'source_ref', v_batch, p_actor
    );
    v_saved := v_saved + 1;
  END LOOP;
  RETURN jsonb_build_object('save_batch_id', v_batch, 'saved', v_saved, 'unchanged', v_unchanged);
END;
$$;

REVOKE ALL ON FUNCTION erp_planning.save_material_requirement_policies(uuid, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.save_material_requirement_policies(uuid, uuid, jsonb, text) TO service_role;
COMMIT;
