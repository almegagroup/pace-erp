/*
 * Migration: 20261015090000_erp_planning_primary_carry_forward
 * Purpose:   Owner decision 2026-10-15 (MTS Customer Plan, Tab 2):
 *              * Use Primary Y/N (per Stroke × RM group) CARRIES FORWARD month
 *                on month. A change made in month M applies from M onward,
 *                until a later month changes it again.
 *              * Stroke periods stay month-only: a change applies to that
 *                month alone; months with no setting use the current stroke.
 *
 * Changes:
 *   1. New erp_planning.stroke_group_primary_decision — append-only, one
 *      current row per company × stroke × group × effective_month. The value
 *      for month M = the current row with the latest effective_month <= M;
 *      no row at all = Yes (default).
 *   2. save_stroke_plan_setting() rewritten:
 *        - p_periods may be empty/null → the month's stroke setting is left
 *          as it is (so saving only Use Primary never freezes the month's
 *          stroke; a later change of the current stroke still applies).
 *        - p_primaries are written to the decision table as CHANGES only:
 *          a value equal to what the month already inherits is not stored;
 *          setting a month back to its inherited value retires that month's
 *          own decision (history kept, row only marked not current).
 *   3. stroke_plan_group_primary (month-bound) is no longer written. It held
 *      no rows on DEV or PROD when this ran; kept for history only.
 */

BEGIN;

CREATE TABLE erp_planning.stroke_group_primary_decision (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES erp_master.companies(id),
  prodshade_material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  stroke_master_id      uuid NOT NULL REFERENCES erp_production.stroke_master(id),
  material_group_id     uuid NOT NULL REFERENCES erp_master.material_category_group(id),
  effective_month       date NOT NULL CHECK (effective_month = date_trunc('month', effective_month)::date),
  use_primary           boolean NOT NULL,
  version_no            integer NOT NULL CHECK (version_no >= 1),
  is_current            boolean NOT NULL DEFAULT true,
  remarks               text,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_stroke_group_primary_decision_version
    UNIQUE (company_id, stroke_master_id, material_group_id, effective_month, version_no)
);
CREATE UNIQUE INDEX ux_stroke_group_primary_decision_current
  ON erp_planning.stroke_group_primary_decision (company_id, stroke_master_id, material_group_id, effective_month)
  WHERE is_current;
CREATE INDEX ix_stroke_group_primary_decision_prodshade
  ON erp_planning.stroke_group_primary_decision (company_id, prodshade_material_id, effective_month)
  WHERE is_current;

COMMENT ON TABLE erp_planning.stroke_group_primary_decision IS
  'Tab 2 Use Primary decision per Stroke × RM group, carried forward: value for month M = current row with the latest effective_month <= M; none = Yes. RM only; PM has no Use Primary control.';
COMMENT ON TABLE erp_planning.stroke_plan_group_primary IS
  'SUPERSEDED 2026-10-15 by stroke_group_primary_decision (carry-forward). No longer written.';

CREATE TRIGGER trg_stroke_group_primary_decision_append_only
  BEFORE UPDATE OR DELETE ON erp_planning.stroke_group_primary_decision
  FOR EACH ROW EXECUTE FUNCTION erp_planning.guard_append_only();

ALTER TABLE erp_planning.stroke_group_primary_decision ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON erp_planning.stroke_group_primary_decision TO service_role;

-- p_periods:   [{ stroke_master_id, period_from, period_to, planned_base_qty? }]  (empty = leave the month's strokes unchanged)
-- p_primaries: [{ stroke_master_id, material_group_id, use_primary }]           (stored only where they change the inherited value)
CREATE OR REPLACE FUNCTION erp_planning.save_stroke_plan_setting(
  p_company_id            uuid,
  p_plan_month            date,
  p_prodshade_material_id uuid,
  p_actor                 uuid,
  p_periods               jsonb,
  p_primaries             jsonb,
  p_remarks               text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_month_end date := (p_plan_month + interval '1 month - 1 day')::date;
  v_periods   jsonb := coalesce(p_periods, '[]'::jsonb);
  v_primaries jsonb := coalesce(p_primaries, '[]'::jsonb);
  v_remarks   text := nullif(btrim(coalesce(p_remarks, '')), '');
  v_current   erp_planning.stroke_plan_setting%ROWTYPE;
  v_here      erp_planning.stroke_group_primary_decision%ROWTYPE;
  v_setting   uuid;
  v_version   integer;
  v_period    jsonb;
  v_primary   jsonb;
  v_stroke    uuid;
  v_from      date;
  v_to        date;
  v_group     uuid;
  v_new       boolean;
  v_prior     boolean;
  v_order     integer := 0;
  v_overlap   integer;
  v_changed   integer := 0;
BEGIN
  IF p_company_id IS NULL OR p_actor IS NULL OR p_prodshade_material_id IS NULL THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_INPUT: company, prodshade and actor are required';
  END IF;
  IF p_plan_month IS NULL OR p_plan_month <> date_trunc('month', p_plan_month)::date THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_MONTH: plan month must be the first day of a month';
  END IF;
  IF jsonb_typeof(v_periods) <> 'array' OR jsonb_typeof(v_primaries) <> 'array' THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_INPUT: periods and primaries must be arrays';
  END IF;
  IF jsonb_array_length(v_periods) = 0 AND jsonb_array_length(v_primaries) = 0 THEN
    RAISE EXCEPTION 'MTS_PLAN_NOTHING_TO_SAVE: no stroke period or Use Primary change was sent';
  END IF;

  -- ── Stroke periods: this month only ──────────────────────────────────────
  IF jsonb_array_length(v_periods) > 0 THEN
    SELECT * INTO v_current
    FROM erp_planning.stroke_plan_setting
    WHERE company_id = p_company_id AND plan_month = p_plan_month
      AND prodshade_material_id = p_prodshade_material_id AND is_current
    FOR UPDATE;
    IF v_current.id IS NOT NULL THEN
      UPDATE erp_planning.stroke_plan_setting SET is_current = false WHERE id = v_current.id;
    END IF;
    v_version := coalesce(v_current.version_no, 0) + 1;

    INSERT INTO erp_planning.stroke_plan_setting (
      company_id, plan_month, prodshade_material_id, version_no, is_current, remarks, created_by
    ) VALUES (
      p_company_id, p_plan_month, p_prodshade_material_id, v_version, true, v_remarks, p_actor
    ) RETURNING id INTO v_setting;

    FOR v_period IN SELECT * FROM jsonb_array_elements(v_periods) LOOP
      v_stroke := nullif(v_period->>'stroke_master_id', '')::uuid;
      v_from   := nullif(v_period->>'period_from', '')::date;
      v_to     := nullif(v_period->>'period_to', '')::date;
      IF v_stroke IS NULL OR v_from IS NULL OR v_to IS NULL OR v_from > v_to THEN
        RAISE EXCEPTION 'MTS_PLAN_STROKE_PERIOD_INVALID: each period needs a stroke and From<=To';
      END IF;
      IF v_from < p_plan_month OR v_to > v_month_end THEN
        RAISE EXCEPTION 'MTS_PLAN_STROKE_PERIOD_OUTSIDE_MONTH: % to % is outside %', v_from, v_to, p_plan_month;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM erp_production.stroke_master s
        WHERE s.id = v_stroke AND s.company_id = p_company_id
          AND s.prodshade_material_id = p_prodshade_material_id
          AND s.po_type = 'MTS' AND s.status = 'APPROVED'
      ) THEN
        RAISE EXCEPTION 'MTS_PLAN_STROKE_INVALID: stroke % is not an APPROVED MTS stroke of this company and Prodshade', v_stroke;
      END IF;
      IF nullif(v_period->>'planned_base_qty', '') IS NOT NULL
         AND (v_period->>'planned_base_qty')::numeric < 0 THEN
        RAISE EXCEPTION 'MTS_PLAN_STROKE_PERIOD_QTY_INVALID';
      END IF;
      INSERT INTO erp_planning.stroke_plan_period (
        setting_id, stroke_master_id, period_from, period_to, planned_base_qty, display_order
      ) VALUES (
        v_setting, v_stroke, v_from, v_to, nullif(v_period->>'planned_base_qty', '')::numeric, v_order
      );
      v_order := v_order + 1;
    END LOOP;

    SELECT count(*) INTO v_overlap
    FROM erp_planning.stroke_plan_period a
    JOIN erp_planning.stroke_plan_period b
      ON b.setting_id = a.setting_id AND b.id <> a.id
     AND a.period_from <= b.period_to AND b.period_from <= a.period_to
    WHERE a.setting_id = v_setting;
    IF v_overlap > 0 THEN
      RAISE EXCEPTION 'MTS_PLAN_STROKE_PERIOD_OVERLAP: stroke periods may not overlap';
    END IF;
  END IF;

  -- ── Use Primary: from this month onward (carry forward) ──────────────────
  -- DEPENDENT: each key's change is decided against the rows already committed
  -- for that key (inherited value, this month's own decision).
  FOR v_primary IN SELECT * FROM jsonb_array_elements(v_primaries) LOOP
    v_stroke := nullif(v_primary->>'stroke_master_id', '')::uuid;
    v_group  := nullif(v_primary->>'material_group_id', '')::uuid;
    IF v_stroke IS NULL OR v_group IS NULL OR (v_primary->>'use_primary') IS NULL THEN
      RAISE EXCEPTION 'MTS_PLAN_PRIMARY_INVALID: stroke, group and use_primary are required';
    END IF;
    v_new := (v_primary->>'use_primary')::boolean;
    IF NOT EXISTS (
      SELECT 1 FROM erp_production.stroke_master s
      WHERE s.id = v_stroke AND s.company_id = p_company_id
        AND s.prodshade_material_id = p_prodshade_material_id
        AND s.po_type = 'MTS' AND s.status = 'APPROVED'
    ) THEN
      RAISE EXCEPTION 'MTS_PLAN_STROKE_INVALID: stroke % is not an APPROVED MTS stroke of this company and Prodshade', v_stroke;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM erp_production.stroke_line l
      WHERE l.stroke_master_id = v_stroke AND l.material_group_id = v_group
    ) THEN
      RAISE EXCEPTION 'MTS_PLAN_PRIMARY_GROUP_NOT_IN_STROKE: group % is not an RM group of stroke %', v_group, v_stroke;
    END IF;

    SELECT d.use_primary INTO v_prior
    FROM erp_planning.stroke_group_primary_decision d
    WHERE d.company_id = p_company_id AND d.stroke_master_id = v_stroke
      AND d.material_group_id = v_group AND d.is_current AND d.effective_month < p_plan_month
    ORDER BY d.effective_month DESC
    LIMIT 1;
    v_prior := coalesce(v_prior, true);

    v_here := NULL;
    SELECT * INTO v_here
    FROM erp_planning.stroke_group_primary_decision d
    WHERE d.company_id = p_company_id AND d.stroke_master_id = v_stroke
      AND d.material_group_id = v_group AND d.effective_month = p_plan_month AND d.is_current
    FOR UPDATE;

    IF v_new = coalesce(v_here.use_primary, v_prior) THEN
      CONTINUE;  -- no change for this month
    END IF;
    IF v_here.id IS NOT NULL THEN
      UPDATE erp_planning.stroke_group_primary_decision SET is_current = false WHERE id = v_here.id;
    END IF;
    IF v_new <> v_prior THEN
      INSERT INTO erp_planning.stroke_group_primary_decision (
        company_id, prodshade_material_id, stroke_master_id, material_group_id,
        effective_month, use_primary, version_no, is_current, remarks, created_by
      )
      SELECT p_company_id, p_prodshade_material_id, v_stroke, v_group,
             p_plan_month, v_new, coalesce(max(d.version_no), 0) + 1, true, v_remarks, p_actor
      FROM erp_planning.stroke_group_primary_decision d
      WHERE d.company_id = p_company_id AND d.stroke_master_id = v_stroke
        AND d.material_group_id = v_group AND d.effective_month = p_plan_month;
    END IF;
    v_changed := v_changed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'setting_id', v_setting,
    'version_no', v_version,
    'primaries_changed', v_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION erp_planning.save_stroke_plan_setting(uuid, date, uuid, uuid, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.save_stroke_plan_setting(uuid, date, uuid, uuid, jsonb, jsonb, text) TO service_role;

COMMIT;
