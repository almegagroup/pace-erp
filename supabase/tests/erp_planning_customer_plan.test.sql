-- erp_planning customer plan — database scenario tests.
--
-- Safe to run on DEV: the whole DO block always ends with RAISE EXCEPTION, so
-- Postgres rolls back every row it inserted. A passing run therefore reports
--   ERROR: ERP_PLANNING_TESTS_PASSED (n checks)
-- and a failing run reports the first failed assertion instead.
-- NEVER run on PROD (it writes, even though it rolls back).
--
-- Fixture: needs one company with an APPROVED MTS stroke whose Prodshade
-- resolves to exactly one SKU via erp_planning.mts_company_skus(). The block
-- picks the first such company/SKU it finds.

DO $$
DECLARE
  v_company uuid;
  v_sku     uuid;
  v_uom     text;
  v_pid     uuid;
  v_month   date := DATE '2026-11-01';
  v_actor   uuid := '00000000-0000-4000-8000-0000000000aa';
  v_res     jsonb;
  v_eff     record;
  v_entry   uuid;
  v_n       integer;
  v_checks  integer := 0;
  v_stroke  uuid;
  v_group   uuid;
BEGIN
  SELECT c.id, s.sku_material_id, m.base_uom_code, s.prodshade_material_id
    INTO v_company, v_sku, v_uom, v_pid
  FROM erp_master.companies c
  CROSS JOIN LATERAL erp_planning.mts_company_skus(c.id) s
  JOIN erp_master.material_master m ON m.id = s.sku_material_id
  WHERE s.match_count = 1
  LIMIT 1;
  IF v_sku IS NULL THEN RAISE EXCEPTION 'FIXTURE_MISSING: no company with a resolvable MTS SKU'; END IF;

  -- T1 Rolling saves and is effective.
  v_res := erp_planning.save_customer_plan_lines(v_company, v_month, 'ROLLING', v_actor,
    jsonb_build_array(jsonb_build_object('sku_material_id', v_sku, 'entered_qty', 100, 'entered_uom_code', v_uom, 'base_qty', 100, 'base_uom_code', v_uom)));
  SELECT * INTO v_eff FROM erp_planning.customer_plan_effective(v_company, ARRAY[v_month]) WHERE sku_material_id = v_sku;
  IF v_eff.effective_qty <> 100 OR v_eff.base_source <> 'ROLLING' THEN RAISE EXCEPTION 'T1 FAIL: %', row_to_json(v_eff); END IF;
  v_checks := v_checks + 1;

  -- T2 Same values again = no new version.
  v_res := erp_planning.save_customer_plan_lines(v_company, v_month, 'ROLLING', v_actor,
    jsonb_build_array(jsonb_build_object('sku_material_id', v_sku, 'entered_qty', 100, 'entered_uom_code', v_uom, 'base_qty', 100, 'base_uom_code', v_uom)));
  IF (v_res->>'saved')::int <> 0 OR (v_res->>'unchanged')::int <> 1 THEN RAISE EXCEPTION 'T2 FAIL: %', v_res; END IF;
  v_checks := v_checks + 1;

  -- T3 Rolling revision keeps history (2 versions, 1 current).
  PERFORM erp_planning.save_customer_plan_lines(v_company, v_month, 'ROLLING', v_actor,
    jsonb_build_array(jsonb_build_object('sku_material_id', v_sku, 'entered_qty', 120, 'entered_uom_code', v_uom, 'base_qty', 120, 'base_uom_code', v_uom)));
  SELECT count(*) INTO v_n FROM erp_planning.customer_plan_line
   WHERE company_id = v_company AND plan_month = v_month AND plan_type = 'ROLLING' AND sku_material_id = v_sku;
  IF v_n <> 2 THEN RAISE EXCEPTION 'T3 FAIL: expected 2 versions, got %', v_n; END IF;
  SELECT count(*) INTO v_n FROM erp_planning.customer_plan_line
   WHERE company_id = v_company AND plan_month = v_month AND plan_type = 'ROLLING' AND sku_material_id = v_sku AND is_current;
  IF v_n <> 1 THEN RAISE EXCEPTION 'T3 FAIL: expected 1 current, got %', v_n; END IF;
  v_checks := v_checks + 1;

  -- T4 Final replaces Rolling (not added to it).
  PERFORM erp_planning.save_customer_plan_lines(v_company, v_month, 'FINAL', v_actor,
    jsonb_build_array(jsonb_build_object('sku_material_id', v_sku, 'entered_qty', 90, 'entered_uom_code', v_uom, 'base_qty', 90, 'base_uom_code', v_uom)));
  SELECT * INTO v_eff FROM erp_planning.customer_plan_effective(v_company, ARRAY[v_month]) WHERE sku_material_id = v_sku;
  IF v_eff.effective_qty <> 90 OR v_eff.base_source <> 'FINAL' OR v_eff.rolling_qty <> 120 THEN RAISE EXCEPTION 'T4 FAIL: %', row_to_json(v_eff); END IF;
  v_checks := v_checks + 1;

  -- T5 Two Additional entries are additive and independent.
  PERFORM erp_planning.save_customer_plan_lines(v_company, v_month, 'ADDITIONAL', v_actor,
    jsonb_build_array(jsonb_build_object('sku_material_id', v_sku, 'entered_qty', 10, 'entered_uom_code', v_uom, 'base_qty', 10, 'base_uom_code', v_uom)));
  PERFORM erp_planning.save_customer_plan_lines(v_company, v_month, 'ADDITIONAL', v_actor,
    jsonb_build_array(jsonb_build_object('sku_material_id', v_sku, 'entered_qty', 5, 'entered_uom_code', v_uom, 'base_qty', 5, 'base_uom_code', v_uom)));
  SELECT * INTO v_eff FROM erp_planning.customer_plan_effective(v_company, ARRAY[v_month]) WHERE sku_material_id = v_sku;
  IF v_eff.effective_qty <> 105 OR v_eff.additional_qty <> 15 THEN RAISE EXCEPTION 'T5 FAIL: %', row_to_json(v_eff); END IF;
  v_checks := v_checks + 1;

  -- T6 Urgent EXTRA adds; Urgent FROM_PLAN does not.
  PERFORM erp_planning.save_customer_plan_lines(v_company, v_month, 'URGENT', v_actor,
    jsonb_build_array(jsonb_build_object('sku_material_id', v_sku, 'entered_qty', 7, 'entered_uom_code', v_uom, 'base_qty', 7, 'base_uom_code', v_uom,
      'urgent_mode', 'EXTRA', 'urgent_from_date', '2026-11-03', 'urgent_to_date', '2026-11-05')));
  PERFORM erp_planning.save_customer_plan_lines(v_company, v_month, 'URGENT', v_actor,
    jsonb_build_array(jsonb_build_object('sku_material_id', v_sku, 'entered_qty', 50, 'entered_uom_code', v_uom, 'base_qty', 50, 'base_uom_code', v_uom,
      'urgent_mode', 'FROM_PLAN', 'urgent_from_date', '2026-11-01', 'urgent_to_date', '2026-11-10')));
  SELECT * INTO v_eff FROM erp_planning.customer_plan_effective(v_company, ARRAY[v_month]) WHERE sku_material_id = v_sku;
  IF v_eff.effective_qty <> 112 OR v_eff.urgent_from_plan_qty <> 50 OR v_eff.urgent_extra_qty <> 7 THEN RAISE EXCEPTION 'T6 FAIL: %', row_to_json(v_eff); END IF;
  v_checks := v_checks + 1;

  -- T7 FROM_PLAN cannot exceed Final/Rolling + Additional (pool = 105, already 50 allocated).
  BEGIN
    PERFORM erp_planning.save_customer_plan_lines(v_company, v_month, 'URGENT', v_actor,
      jsonb_build_array(jsonb_build_object('sku_material_id', v_sku, 'entered_qty', 60, 'entered_uom_code', v_uom, 'base_qty', 60, 'base_uom_code', v_uom,
        'urgent_mode', 'FROM_PLAN', 'urgent_from_date', '2026-11-11', 'urgent_to_date', '2026-11-12')));
    RAISE EXCEPTION 'T7 FAIL: overdraw was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MTS_PLAN_URGENT_FROM_PLAN_EXCEEDS%' THEN RAISE EXCEPTION 'T7 FAIL: %', SQLERRM; END IF;
  END;
  v_checks := v_checks + 1;

  -- T8 Reducing Final below an existing FROM_PLAN allocation is rejected too.
  BEGIN
    PERFORM erp_planning.save_customer_plan_lines(v_company, v_month, 'FINAL', v_actor,
      jsonb_build_array(jsonb_build_object('sku_material_id', v_sku, 'entered_qty', 20, 'entered_uom_code', v_uom, 'base_qty', 20, 'base_uom_code', v_uom)));
    RAISE EXCEPTION 'T8 FAIL: stranding reduction was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MTS_PLAN_URGENT_FROM_PLAN_EXCEEDS%' THEN RAISE EXCEPTION 'T8 FAIL: %', SQLERRM; END IF;
  END;
  v_checks := v_checks + 1;

  -- T9 Cancel one Additional entry: new cancelled version, quantity leaves the total.
  SELECT entry_id INTO v_entry FROM erp_planning.customer_plan_line
   WHERE company_id = v_company AND plan_month = v_month AND plan_type = 'ADDITIONAL' AND base_qty = 5 AND is_current;
  PERFORM erp_planning.save_customer_plan_lines(v_company, v_month, 'ADDITIONAL', v_actor,
    jsonb_build_array(jsonb_build_object('entry_id', v_entry, 'sku_material_id', v_sku, 'cancel', true)));
  SELECT * INTO v_eff FROM erp_planning.customer_plan_effective(v_company, ARRAY[v_month]) WHERE sku_material_id = v_sku;
  IF v_eff.effective_qty <> 107 OR v_eff.additional_qty <> 10 THEN RAISE EXCEPTION 'T9 FAIL: %', row_to_json(v_eff); END IF;
  SELECT count(*) INTO v_n FROM erp_planning.customer_plan_line WHERE entry_id = v_entry;
  IF v_n <> 2 THEN RAISE EXCEPTION 'T9 FAIL: cancel must add a version, got % rows', v_n; END IF;
  v_checks := v_checks + 1;

  -- T10 Append-only: delete and in-place edit are blocked.
  BEGIN
    DELETE FROM erp_planning.customer_plan_line WHERE entry_id = v_entry;
    RAISE EXCEPTION 'T10 FAIL: delete accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'PLANNING_APPEND_ONLY%' THEN RAISE EXCEPTION 'T10 FAIL: %', SQLERRM; END IF;
  END;
  BEGIN
    UPDATE erp_planning.customer_plan_line SET base_qty = 1 WHERE entry_id = v_entry AND is_current;
    RAISE EXCEPTION 'T10 FAIL: edit accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'PLANNING_APPEND_ONLY%' THEN RAISE EXCEPTION 'T10 FAIL: %', SQLERRM; END IF;
  END;
  v_checks := v_checks + 1;

  -- T11 Urgent without a period is rejected; non-MTS material is rejected.
  BEGIN
    PERFORM erp_planning.save_customer_plan_lines(v_company, v_month, 'URGENT', v_actor,
      jsonb_build_array(jsonb_build_object('sku_material_id', v_sku, 'entered_qty', 1, 'entered_uom_code', v_uom, 'base_qty', 1, 'base_uom_code', v_uom, 'urgent_mode', 'EXTRA')));
    RAISE EXCEPTION 'T11 FAIL: urgent without period accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MTS_PLAN_URGENT_PERIOD_INVALID%' THEN RAISE EXCEPTION 'T11 FAIL: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM erp_planning.save_customer_plan_lines(v_company, v_month, 'ROLLING', v_actor,
      jsonb_build_array(jsonb_build_object('sku_material_id', v_pid, 'entered_qty', 1, 'entered_uom_code', v_uom, 'base_qty', 1, 'base_uom_code', v_uom)));
    RAISE EXCEPTION 'T11 FAIL: non-SKU accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MTS_PLAN_SKU_NOT_IN_COMPANY%' THEN RAISE EXCEPTION 'T11 FAIL: %', SQLERRM; END IF;
  END;
  v_checks := v_checks + 1;

  -- T12 Entered 0 is a plan (0), not "no plan" (NULL).
  PERFORM erp_planning.save_customer_plan_lines(v_company, DATE '2026-12-01', 'ROLLING', v_actor,
    jsonb_build_array(jsonb_build_object('sku_material_id', v_sku, 'entered_qty', 0, 'entered_uom_code', v_uom, 'base_qty', 0, 'base_uom_code', v_uom)));
  SELECT * INTO v_eff FROM erp_planning.customer_plan_effective(v_company, ARRAY[DATE '2026-12-01']) WHERE sku_material_id = v_sku;
  IF v_eff.effective_qty IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'T12 FAIL: %', row_to_json(v_eff); END IF;
  SELECT count(*) INTO v_n FROM erp_planning.customer_plan_effective(v_company, ARRAY[DATE '2027-01-01']);
  IF v_n <> 0 THEN RAISE EXCEPTION 'T12 FAIL: empty month should return no rows'; END IF;
  v_checks := v_checks + 1;

  -- T13 Stroke setting: versioned, periods validated, primary only on the stroke's own RM groups.
  SELECT s.id INTO v_stroke FROM erp_production.stroke_master s
   WHERE s.company_id = v_company AND s.prodshade_material_id = v_pid AND s.po_type = 'MTS' AND s.status = 'APPROVED' LIMIT 1;
  SELECT l.material_group_id INTO v_group FROM erp_production.stroke_line l
   WHERE l.stroke_master_id = v_stroke AND l.material_group_id IS NOT NULL LIMIT 1;
  v_res := erp_planning.save_stroke_plan_setting(v_company, v_month, v_pid, v_actor,
    jsonb_build_array(jsonb_build_object('stroke_master_id', v_stroke, 'period_from', '2026-11-01', 'period_to', '2026-11-30')),
    CASE WHEN v_group IS NULL THEN '[]'::jsonb
         ELSE jsonb_build_array(jsonb_build_object('stroke_master_id', v_stroke, 'material_group_id', v_group, 'use_primary', false)) END);
  IF (v_res->>'version_no')::int <> 1 THEN RAISE EXCEPTION 'T13 FAIL: %', v_res; END IF;
  v_res := erp_planning.save_stroke_plan_setting(v_company, v_month, v_pid, v_actor,
    jsonb_build_array(jsonb_build_object('stroke_master_id', v_stroke, 'period_from', '2026-11-01', 'period_to', '2026-11-15')), '[]'::jsonb);
  IF (v_res->>'version_no')::int <> 2 THEN RAISE EXCEPTION 'T13 FAIL: second save should be version 2, %', v_res; END IF;
  BEGIN
    PERFORM erp_planning.save_stroke_plan_setting(v_company, v_month, v_pid, v_actor,
      jsonb_build_array(
        jsonb_build_object('stroke_master_id', v_stroke, 'period_from', '2026-11-01', 'period_to', '2026-11-15'),
        jsonb_build_object('stroke_master_id', v_stroke, 'period_from', '2026-11-10', 'period_to', '2026-11-30')), '[]'::jsonb);
    RAISE EXCEPTION 'T13 FAIL: overlap accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MTS_PLAN_STROKE_PERIOD_OVERLAP%' THEN RAISE EXCEPTION 'T13 FAIL: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM erp_planning.save_stroke_plan_setting(v_company, v_month, v_pid, v_actor,
      jsonb_build_array(jsonb_build_object('stroke_master_id', v_stroke, 'period_from', '2026-11-20', 'period_to', '2026-12-02')), '[]'::jsonb);
    RAISE EXCEPTION 'T13 FAIL: out-of-month period accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MTS_PLAN_STROKE_PERIOD_OUTSIDE_MONTH%' THEN RAISE EXCEPTION 'T13 FAIL: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM erp_planning.save_stroke_plan_setting(v_company, v_month, v_pid, v_actor,
      jsonb_build_array(jsonb_build_object('stroke_master_id', v_stroke, 'period_from', '2026-11-01', 'period_to', '2026-11-30')),
      jsonb_build_array(jsonb_build_object('stroke_master_id', v_stroke, 'material_group_id', '00000000-0000-4000-8000-000000000bad', 'use_primary', true)));
    RAISE EXCEPTION 'T13 FAIL: foreign group accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MTS_PLAN_PRIMARY_GROUP_NOT_IN_STROKE%' THEN RAISE EXCEPTION 'T13 FAIL: %', SQLERRM; END IF;
  END;
  SELECT count(*) INTO v_n FROM erp_planning.stroke_plan_setting
   WHERE company_id = v_company AND plan_month = v_month AND prodshade_material_id = v_pid AND is_current;
  IF v_n <> 1 THEN RAISE EXCEPTION 'T13 FAIL: % current settings after rejected saves', v_n; END IF;
  v_checks := v_checks + 1;

  RAISE EXCEPTION 'ERP_PLANNING_TESTS_PASSED (% checks, stroke group fixture: %)', v_checks, coalesce(v_group::text, 'none');
END;
$$;
