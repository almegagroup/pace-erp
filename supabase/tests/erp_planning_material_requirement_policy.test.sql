-- erp_planning material requirement policy (PO22 Material Settings) — DB scenario tests.
--
-- Same convention as erp_planning_customer_plan.test.sql: the DO block always
-- ends with RAISE EXCEPTION, so every inserted row is rolled back. A passing
-- run reports
--   ERROR: MTS_REQ_POLICY_TESTS_PASSED (n checks)
-- NEVER run on PROD (it writes, even though it rolls back). Needs migration
-- 20261016100000 applied.
--
-- Fixture: any company plus one RM material and one PM material with a base unit.

DO $$
DECLARE
  v_company  uuid;
  v_company2 uuid;
  v_rm       uuid;
  v_rm_uom   text;
  v_pm       uuid;
  v_fg       uuid;
  v_actor    uuid := '00000000-0000-4000-8000-0000000000bb';
  v_res      jsonb;
  v_row      erp_planning.material_requirement_policy%ROWTYPE;
  v_n        integer;
  v_checks   integer := 0;
BEGIN
  SELECT id INTO v_company FROM erp_master.companies ORDER BY company_code LIMIT 1;
  SELECT id INTO v_company2 FROM erp_master.companies WHERE id <> v_company ORDER BY company_code LIMIT 1;
  SELECT id, base_uom_code INTO v_rm, v_rm_uom FROM erp_master.material_master WHERE material_type = 'RM' AND base_uom_code IS NOT NULL LIMIT 1;
  SELECT id INTO v_pm FROM erp_master.material_master WHERE material_type = 'PM' LIMIT 1;
  SELECT id INTO v_fg FROM erp_master.material_master WHERE material_type = 'FG' LIMIT 1;
  IF v_company IS NULL OR v_company2 IS NULL OR v_rm IS NULL OR v_pm IS NULL THEN
    RAISE EXCEPTION 'FIXTURE_MISSING: need two companies, one RM and one PM material';
  END IF;

  -- P1 Target only: Critical defaults to ROUNDUP(Target / 2).
  v_res := erp_planning.save_material_requirement_policies(v_company, v_actor,
    jsonb_build_array(jsonb_build_object('material_id', v_rm, 'effective_from', '2026-10-01', 'target_cov_days', 45, 'moq_source', 'NONE')));
  SELECT * INTO v_row FROM erp_planning.material_requirement_policy
   WHERE company_id = v_company AND material_id = v_rm AND effective_from = '2026-10-01' AND is_current;
  IF v_row.critical_cov_days <> 23 OR v_row.version_no <> 1 THEN RAISE EXCEPTION 'P1 FAIL: %', row_to_json(v_row); END IF;
  v_checks := v_checks + 1;

  -- P2 Same values again = unchanged, no new version.
  v_res := erp_planning.save_material_requirement_policies(v_company, v_actor,
    jsonb_build_array(jsonb_build_object('material_id', v_rm, 'effective_from', '2026-10-01', 'target_cov_days', 45, 'critical_cov_days', 23, 'moq_source', 'NONE')));
  IF (v_res->>'saved')::int <> 0 OR (v_res->>'unchanged')::int <> 1 THEN RAISE EXCEPTION 'P2 FAIL: %', v_res; END IF;
  v_checks := v_checks + 1;

  -- P3 Independent Critical edit creates version 2, history kept.
  PERFORM erp_planning.save_material_requirement_policies(v_company, v_actor,
    jsonb_build_array(jsonb_build_object('material_id', v_rm, 'effective_from', '2026-10-01', 'target_cov_days', 45, 'critical_cov_days', 10, 'moq_source', 'NONE')));
  SELECT count(*) INTO v_n FROM erp_planning.material_requirement_policy WHERE company_id = v_company AND material_id = v_rm;
  IF v_n <> 2 THEN RAISE EXCEPTION 'P3 FAIL: expected 2 versions, got %', v_n; END IF;
  SELECT * INTO v_row FROM erp_planning.material_requirement_policy
   WHERE company_id = v_company AND material_id = v_rm AND effective_from = '2026-10-01' AND is_current;
  IF v_row.critical_cov_days <> 10 OR v_row.version_no <> 2 THEN RAISE EXCEPTION 'P3 FAIL: %', row_to_json(v_row); END IF;
  v_checks := v_checks + 1;

  -- P4 Same material, another company: independent policy.
  PERFORM erp_planning.save_material_requirement_policies(v_company2, v_actor,
    jsonb_build_array(jsonb_build_object('material_id', v_rm, 'effective_from', '2026-10-01', 'target_cov_days', 30, 'moq_source', 'NONE')));
  SELECT * INTO v_row FROM erp_planning.material_requirement_policy
   WHERE company_id = v_company AND material_id = v_rm AND is_current;
  IF v_row.target_cov_days <> 45 THEN RAISE EXCEPTION 'P4 FAIL: other company changed this one'; END IF;
  v_checks := v_checks + 1;

  -- P5 MOQ with no fixed vendor minimum: COMPANY source in base unit, active.
  PERFORM erp_planning.save_material_requirement_policies(v_company, v_actor,
    jsonb_build_array(jsonb_build_object('material_id', v_rm, 'effective_from', '2026-11-01', 'target_cov_days', 40,
      'moq_qty', 5000, 'moq_uom_code', v_rm_uom, 'moq_source', 'COMPANY', 'moq_active', true)));
  SELECT * INTO v_row FROM erp_planning.material_requirement_policy
   WHERE company_id = v_company AND material_id = v_rm AND effective_from = '2026-11-01' AND is_current;
  IF v_row.moq_source <> 'COMPANY' OR NOT v_row.moq_active THEN RAISE EXCEPTION 'P5 FAIL: %', row_to_json(v_row); END IF;
  v_checks := v_checks + 1;

  -- P6 Rejections: negative, NONE with qty, qty without unit, unknown unit, FG material, duplicate row.
  BEGIN
    PERFORM erp_planning.save_material_requirement_policies(v_company, v_actor,
      jsonb_build_array(jsonb_build_object('material_id', v_pm, 'effective_from', '2026-10-01', 'target_cov_days', -1)));
    RAISE EXCEPTION 'P6 FAIL: negative accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MTS_REQ_POLICY_NEGATIVE%' THEN RAISE EXCEPTION 'P6a FAIL: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM erp_planning.save_material_requirement_policies(v_company, v_actor,
      jsonb_build_array(jsonb_build_object('material_id', v_pm, 'effective_from', '2026-10-01', 'moq_qty', 10, 'moq_uom_code', 'NOS', 'moq_source', 'NONE')));
    RAISE EXCEPTION 'P6 FAIL: NONE with qty accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MTS_REQ_POLICY_MOQ_SHAPE%' THEN RAISE EXCEPTION 'P6b FAIL: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM erp_planning.save_material_requirement_policies(v_company, v_actor,
      jsonb_build_array(jsonb_build_object('material_id', v_pm, 'effective_from', '2026-10-01', 'moq_qty', 10, 'moq_source', 'VENDOR')));
    RAISE EXCEPTION 'P6 FAIL: qty without unit accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MTS_REQ_POLICY_MOQ_UOM_REQUIRED%' THEN RAISE EXCEPTION 'P6c FAIL: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM erp_planning.save_material_requirement_policies(v_company, v_actor,
      jsonb_build_array(jsonb_build_object('material_id', v_rm, 'effective_from', '2026-12-01', 'moq_qty', 1, 'moq_uom_code', 'NO_SUCH_UNIT', 'moq_source', 'VENDOR')));
    RAISE EXCEPTION 'P6 FAIL: unknown unit accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MTS_REQ_POLICY_MOQ_UOM_INVALID%' THEN RAISE EXCEPTION 'P6d FAIL: %', SQLERRM; END IF;
  END;
  IF v_fg IS NOT NULL THEN
    BEGIN
      PERFORM erp_planning.save_material_requirement_policies(v_company, v_actor,
        jsonb_build_array(jsonb_build_object('material_id', v_fg, 'effective_from', '2026-10-01', 'target_cov_days', 10)));
      RAISE EXCEPTION 'P6 FAIL: FG accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'MTS_REQ_POLICY_MATERIAL_TYPE%' THEN RAISE EXCEPTION 'P6e FAIL: %', SQLERRM; END IF;
    END;
  END IF;
  BEGIN
    PERFORM erp_planning.save_material_requirement_policies(v_company, v_actor, jsonb_build_array(
      jsonb_build_object('material_id', v_pm, 'effective_from', '2026-10-01', 'target_cov_days', 10),
      jsonb_build_object('material_id', v_pm, 'effective_from', '2026-10-01', 'target_cov_days', 12)));
    RAISE EXCEPTION 'P6 FAIL: duplicate accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MTS_REQ_POLICY_DUPLICATE_ROW%' THEN RAISE EXCEPTION 'P6f FAIL: %', SQLERRM; END IF;
  END;
  v_checks := v_checks + 1;

  -- P7 Append-only: rows cannot be deleted or edited.
  BEGIN
    DELETE FROM erp_planning.material_requirement_policy WHERE company_id = v_company AND material_id = v_rm;
    RAISE EXCEPTION 'P7 FAIL: delete accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'PLANNING_APPEND_ONLY%' THEN RAISE EXCEPTION 'P7a FAIL: %', SQLERRM; END IF;
  END;
  BEGIN
    UPDATE erp_planning.material_requirement_policy SET target_cov_days = 1 WHERE company_id = v_company AND material_id = v_rm AND is_current;
    RAISE EXCEPTION 'P7 FAIL: edit accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'PLANNING_APPEND_ONLY%' THEN RAISE EXCEPTION 'P7b FAIL: %', SQLERRM; END IF;
  END;
  v_checks := v_checks + 1;

  -- P8 A failing row rolls back the whole batch (atomic).
  BEGIN
    PERFORM erp_planning.save_material_requirement_policies(v_company, v_actor, jsonb_build_array(
      jsonb_build_object('material_id', v_pm, 'effective_from', '2026-10-01', 'target_cov_days', 20),
      jsonb_build_object('material_id', v_pm, 'effective_from', '2026-11-01', 'target_cov_days', -5)));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  SELECT count(*) INTO v_n FROM erp_planning.material_requirement_policy WHERE company_id = v_company AND material_id = v_pm;
  IF v_n <> 0 THEN RAISE EXCEPTION 'P8 FAIL: partial batch left % rows', v_n; END IF;
  v_checks := v_checks + 1;

  RAISE EXCEPTION 'MTS_REQ_POLICY_TESTS_PASSED (% checks)', v_checks;
END;
$$;
