-- Fix: stroke_line joins to its header via stroke_master_id (the original function used a non-existent stroke_id, so every save failed).
BEGIN;
CREATE OR REPLACE FUNCTION erp_planning.save_material_group_coverage_policies(
  p_company_id uuid, p_actor uuid, p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, erp_planning, erp_master
AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_row jsonb;
  v_group uuid;
  v_from date;
  v_target numeric;
  v_critical numeric;
  v_max numeric;
  v_remarks text;
  v_current erp_planning.material_group_coverage_policy%ROWTYPE;
  v_seen text[] := ARRAY[]::text[];
  v_key text;
  v_saved integer := 0;
  v_unchanged integer := 0;
BEGIN
  IF p_company_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'MTS_GROUP_POLICY_INVALID_INPUT: company and actor are required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'MTS_GROUP_POLICY_NO_ROWS: nothing to save';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_group := nullif(v_row->>'material_group_id', '')::uuid;
    v_from := nullif(v_row->>'effective_from', '')::date;
    v_target := coalesce(nullif(v_row->>'target_cov_days', '')::numeric, 30);
    v_critical := coalesce(nullif(v_row->>'critical_cov_days', '')::numeric, ceil(v_target / 2));
    v_max := nullif(v_row->>'desired_max_days_override', '')::numeric;
    v_remarks := nullif(btrim(coalesce(v_row->>'remarks', '')), '');
    IF v_group IS NULL OR v_from IS NULL THEN
      RAISE EXCEPTION 'MTS_GROUP_POLICY_INVALID_INPUT: group and effective date are required';
    END IF;
    IF v_target < 0 OR v_critical < 0 OR (v_max IS NOT NULL AND v_max < 0) THEN
      RAISE EXCEPTION 'MTS_GROUP_POLICY_NEGATIVE: days may not be negative';
    END IF;
    IF v_critical > v_target THEN
      RAISE EXCEPTION 'MTS_GROUP_POLICY_CRITICAL_GT_TARGET: Critical days may not exceed Target days';
    END IF;
    v_key := v_group::text || '|' || v_from::text;
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'MTS_GROUP_POLICY_DUPLICATE_ROW: group % appears twice for %', v_group, v_from;
    END IF;
    v_seen := array_append(v_seen, v_key);
    -- A group must belong to this company's active MTS stroke or Pack BOM inputs.
    IF NOT EXISTS (
      SELECT 1 FROM erp_production.stroke_master s
      JOIN erp_production.stroke_line l ON l.stroke_master_id = s.id
      WHERE s.company_id = p_company_id AND s.po_type = 'MTS' AND s.status = 'APPROVED'
        AND l.material_group_id = v_group
      UNION ALL
      SELECT 1 FROM erp_production.pack_bom b
      JOIN erp_production.pack_bom_line l ON l.pack_bom_id = b.id
      WHERE b.company_id = p_company_id AND b.status = 'ACTIVE'
        AND l.material_group_id = v_group
    ) THEN
      RAISE EXCEPTION 'MTS_GROUP_POLICY_GROUP_NOT_IN_COMPANY: group is not used by this company''s active MTS formulation';
    END IF;

    v_current := NULL;
    SELECT * INTO v_current FROM erp_planning.material_group_coverage_policy
    WHERE company_id = p_company_id AND material_group_id = v_group
      AND effective_from = v_from AND is_current FOR UPDATE;
    IF FOUND AND v_current.target_cov_days = v_target AND v_current.critical_cov_days = v_critical
       AND v_current.desired_max_days_override IS NOT DISTINCT FROM v_max
       AND v_current.remarks IS NOT DISTINCT FROM v_remarks THEN
      v_unchanged := v_unchanged + 1;
      CONTINUE;
    END IF;
    IF FOUND THEN
      UPDATE erp_planning.material_group_coverage_policy SET is_current = false WHERE id = v_current.id;
    END IF;
    INSERT INTO erp_planning.material_group_coverage_policy
      (company_id, material_group_id, effective_from, version_no, is_current, target_cov_days, critical_cov_days, desired_max_days_override, remarks, save_batch_id, created_by)
    VALUES
      (p_company_id, v_group, v_from, coalesce(v_current.version_no, 0) + 1, true, v_target, v_critical, v_max, v_remarks, v_batch, p_actor);
    v_saved := v_saved + 1;
  END LOOP;
  RETURN jsonb_build_object('save_batch_id', v_batch, 'saved', v_saved, 'unchanged', v_unchanged);
END;
$$;

REVOKE ALL ON FUNCTION erp_planning.save_material_group_coverage_policies(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.save_material_group_coverage_policies(uuid, uuid, jsonb) TO service_role;
COMMIT;
