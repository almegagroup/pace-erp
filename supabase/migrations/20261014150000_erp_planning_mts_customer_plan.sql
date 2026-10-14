/*
 * Migration: 20261014150000_erp_planning_mts_customer_plan
 * Purpose:   MTS Procurement Planning — first page (three-tab Customer Plan).
 *            Owner decisions: docs/mts-planning/DECISION-REGISTER.md on
 *            agent/chatgpt (commits 31dbfee, a718f34); technical evidence:
 *            docs/mts-planning/OPEN-TECHNICAL-QUESTIONS.md (Step 1C closure).
 *
 * Creates the dedicated erp_planning schema (owner T04) with:
 *   1. customer_plan_line        — append-only, versioned SKU plan entries
 *                                  (ROLLING / FINAL / ADDITIONAL / URGENT).
 *   2. stroke_plan_setting       — Tab 2 planning-only stroke periods and
 *      stroke_plan_period          Use Primary Y/N per effective Stroke × RM
 *      stroke_plan_group_primary   material group (never touches Stroke Master).
 *   3. mts_company_skus()        — company MTS SKU list, same SKU↔Prodshade
 *                                  resolution rule production uses
 *                                  (mts_creation_session.handlers.ts resolveSkuMaterial).
 *   4. customer_plan_effective() — effective monthly demand per SKU.
 *   5. save_customer_plan_lines() / save_stroke_plan_setting() — atomic writes
 *                                  (CLAUDE.md §8B: multi-step writes in one RPC).
 *
 * Planning never writes to PO / CSN / GRN / stock / production / dispatch.
 * No historical import here (owner: import only after the page is approved).
 *
 * After applying (DEV or PROD): add erp_planning to Dashboard → Settings → API
 * → Exposed schemas (CLAUDE.md §8 — platform config, not in this migration),
 * then NOTIFY pgrst, 'reload schema'; and run migration-integrity-check.
 */

BEGIN;

CREATE SCHEMA IF NOT EXISTS erp_planning;
GRANT USAGE ON SCHEMA erp_planning TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Customer plan lines (Tab 1)
-- ───────────────────────────────────────────────────────────────────────────
-- One row per VERSION of a logical entry. entry_id groups the versions.
--   ROLLING / FINAL : exactly one logical entry per company × month × SKU × type;
--                     a re-save creates the next version of that entry.
--   ADDITIONAL / URGENT : every new entry gets its own entry_id (repeatable);
--                     editing an entry creates its next version.
-- Rows are never updated (except is_current true→false) and never deleted.
CREATE TABLE erp_planning.customer_plan_line (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id         uuid NOT NULL,
  version_no       integer NOT NULL CHECK (version_no >= 1),
  is_current       boolean NOT NULL DEFAULT true,
  company_id       uuid NOT NULL REFERENCES erp_master.companies(id),
  plan_month       date NOT NULL CHECK (plan_month = date_trunc('month', plan_month)::date),
  plan_type        text NOT NULL CHECK (plan_type IN ('ROLLING', 'FINAL', 'ADDITIONAL', 'URGENT')),
  urgent_mode      text CHECK (urgent_mode IN ('FROM_PLAN', 'EXTRA')),
  urgent_from_date date,
  urgent_to_date   date,
  sku_material_id  uuid NOT NULL REFERENCES erp_master.material_master(id),
  entered_qty      numeric(18,6) NOT NULL CHECK (entered_qty >= 0),
  entered_uom_code text NOT NULL,
  base_qty         numeric(18,6) NOT NULL CHECK (base_qty >= 0),
  base_uom_code    text NOT NULL,
  is_cancelled     boolean NOT NULL DEFAULT false,
  remarks          text,
  source_system    text NOT NULL DEFAULT 'ERP_ENTRY'
                   CHECK (source_system IN ('ERP_ENTRY', 'LEGACY_GOOGLE_SHEETS')),
  source_ref       jsonb,
  save_batch_id    uuid NOT NULL,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_customer_plan_line_entry_version UNIQUE (entry_id, version_no),
  -- Urgent rows always carry a mode and a dated period; other types never do.
  CONSTRAINT ck_customer_plan_line_urgent_shape CHECK (
    (plan_type = 'URGENT'
      AND urgent_mode IS NOT NULL
      AND urgent_from_date IS NOT NULL
      AND urgent_to_date IS NOT NULL
      AND urgent_from_date <= urgent_to_date)
    OR
    (plan_type <> 'URGENT'
      AND urgent_mode IS NULL
      AND urgent_from_date IS NULL
      AND urgent_to_date IS NULL)
  )
);

COMMENT ON TABLE erp_planning.customer_plan_line IS
  'MTS customer plan (Asian Paints, company-wise). Append-only versioned entries. Effective monthly demand = latest FINAL if present else latest ROLLING, + ADDITIONAL + URGENT EXTRA. URGENT FROM_PLAN re-phases existing demand and never adds.';
COMMENT ON COLUMN erp_planning.customer_plan_line.base_qty IS
  'Quantity converted to the SKU base UoM at save time by the backend; entered_qty/entered_uom_code keep what the user typed.';
COMMENT ON COLUMN erp_planning.customer_plan_line.source_system IS
  'ERP_ENTRY for page entries. LEGACY_GOOGLE_SHEETS reserved for the later, separately approved historical import.';

CREATE UNIQUE INDEX ux_customer_plan_line_current_entry
  ON erp_planning.customer_plan_line (entry_id) WHERE is_current;
CREATE UNIQUE INDEX ux_customer_plan_line_current_base_key
  ON erp_planning.customer_plan_line (company_id, plan_month, plan_type, sku_material_id)
  WHERE is_current AND plan_type IN ('ROLLING', 'FINAL');
CREATE INDEX ix_customer_plan_line_company_month
  ON erp_planning.customer_plan_line (company_id, plan_month, plan_type) WHERE is_current;
CREATE INDEX ix_customer_plan_line_history
  ON erp_planning.customer_plan_line (company_id, plan_month, sku_material_id, created_at);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Tab 2: planning-only stroke periods and RM-group Use Primary
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE erp_planning.stroke_plan_setting (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES erp_master.companies(id),
  plan_month            date NOT NULL CHECK (plan_month = date_trunc('month', plan_month)::date),
  prodshade_material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  version_no            integer NOT NULL CHECK (version_no >= 1),
  is_current            boolean NOT NULL DEFAULT true,
  remarks               text,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_stroke_plan_setting_version UNIQUE (company_id, plan_month, prodshade_material_id, version_no)
);
CREATE UNIQUE INDEX ux_stroke_plan_setting_current
  ON erp_planning.stroke_plan_setting (company_id, plan_month, prodshade_material_id) WHERE is_current;

COMMENT ON TABLE erp_planning.stroke_plan_setting IS
  'Tab 2 planning assumption per company × month × Prodshade (versioned). No row = default: company current MTS stroke for the whole month, Use Primary = Yes for every RM group.';

CREATE TABLE erp_planning.stroke_plan_period (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_id       uuid NOT NULL REFERENCES erp_planning.stroke_plan_setting(id),
  stroke_master_id uuid NOT NULL REFERENCES erp_production.stroke_master(id),
  period_from      date NOT NULL,
  period_to        date NOT NULL,
  planned_base_qty numeric(18,6) CHECK (planned_base_qty IS NULL OR planned_base_qty >= 0),
  display_order    integer NOT NULL DEFAULT 0,
  CONSTRAINT ck_stroke_plan_period_range CHECK (period_from <= period_to)
);
CREATE INDEX ix_stroke_plan_period_setting ON erp_planning.stroke_plan_period (setting_id);
COMMENT ON COLUMN erp_planning.stroke_plan_period.planned_base_qty IS
  'Optional user override of the Prodshade quantity for this period. NULL = calendar-day pro-rata (applied by the later requirement calculation).';

CREATE TABLE erp_planning.stroke_plan_group_primary (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_id        uuid NOT NULL REFERENCES erp_planning.stroke_plan_setting(id),
  stroke_master_id  uuid NOT NULL REFERENCES erp_production.stroke_master(id),
  material_group_id uuid NOT NULL REFERENCES erp_master.material_category_group(id),
  use_primary       boolean NOT NULL,
  CONSTRAINT uq_stroke_plan_group_primary UNIQUE (setting_id, stroke_master_id, material_group_id)
);
COMMENT ON TABLE erp_planning.stroke_plan_group_primary IS
  'RM only. Primary = the effective Stroke line''s own material (stroke_line.material_id). PM groups have no Use Primary control (owner, 2026-10-14).';

-- ───────────────────────────────────────────────────────────────────────────
-- Append-only guard: no DELETE; UPDATE may only retire the current version.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION erp_planning.guard_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PLANNING_APPEND_ONLY: % rows cannot be deleted', TG_TABLE_NAME;
  END IF;
  IF (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current')
     OR NOT (OLD.is_current AND NOT NEW.is_current) THEN
    RAISE EXCEPTION 'PLANNING_APPEND_ONLY: % rows are immutable; only is_current true->false is allowed', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_customer_plan_line_append_only
  BEFORE UPDATE OR DELETE ON erp_planning.customer_plan_line
  FOR EACH ROW EXECUTE FUNCTION erp_planning.guard_append_only();
CREATE TRIGGER trg_stroke_plan_setting_append_only
  BEFORE UPDATE OR DELETE ON erp_planning.stroke_plan_setting
  FOR EACH ROW EXECUTE FUNCTION erp_planning.guard_append_only();

CREATE OR REPLACE FUNCTION erp_planning.guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PLANNING_APPEND_ONLY: % rows are immutable', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_stroke_plan_period_immutable
  BEFORE UPDATE OR DELETE ON erp_planning.stroke_plan_period
  FOR EACH ROW EXECUTE FUNCTION erp_planning.guard_immutable();
CREATE TRIGGER trg_stroke_plan_group_primary_immutable
  BEFORE UPDATE OR DELETE ON erp_planning.stroke_plan_group_primary
  FOR EACH ROW EXECUTE FUNCTION erp_planning.guard_immutable();

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Company MTS SKU list
-- ───────────────────────────────────────────────────────────────────────────
-- Prodshade = any Prodshade with an APPROVED po_type='MTS' stroke in this
-- company. SKU = FG material whose external_code or material_name equals the
-- Prodshade's external_code||pack_code or material_name||pack_code (case-
-- insensitive), for each ACTIVE prodshade_pack_config pack code — the same
-- rule production uses (resolveSkuMaterial). match_count > 1 marks an
-- ambiguous name match; callers must not treat those as a resolved SKU.
CREATE OR REPLACE FUNCTION erp_planning.mts_company_skus(p_company_id uuid)
RETURNS TABLE (
  sku_material_id       uuid,
  prodshade_material_id uuid,
  pack_code             text,
  match_count           integer
)
LANGUAGE sql
STABLE
AS $$
  WITH prodshades AS (
    SELECT DISTINCT s.prodshade_material_id AS pid
    FROM erp_production.stroke_master s
    WHERE s.company_id = p_company_id
      AND s.po_type = 'MTS'
      AND s.status = 'APPROVED'
  ),
  pairs AS (
    SELECT p.id AS pid, p.external_code, p.material_name, pk.pack_code
    FROM prodshades ps
    JOIN erp_master.material_master p ON p.id = ps.pid
    JOIN erp_production.prodshade_pack_config pc ON pc.material_id = p.id AND pc.active
    JOIN erp_production.pack_code_master pk ON pk.id = pc.pack_code_id
  ),
  keyed AS (
    SELECT DISTINCT pid, pack_code, upper(k) AS match_key
    FROM pairs,
         LATERAL (VALUES (coalesce(external_code, '') || pack_code), (material_name || pack_code)) AS v(k)
    WHERE upper(k) <> upper(pack_code)
  ),
  hits AS (
    SELECT DISTINCT k.pid, k.pack_code, f.id AS sku_id
    FROM keyed k
    JOIN erp_master.material_master f
      ON f.material_type = 'FG'
     AND f.status = 'ACTIVE'
     AND (upper(f.external_code) = k.match_key OR upper(f.material_name) = k.match_key)
  )
  SELECT h.sku_id, h.pid, h.pack_code,
         (count(*) OVER (PARTITION BY h.pid, h.pack_code))::integer
  FROM hits h;
$$;

COMMENT ON FUNCTION erp_planning.mts_company_skus(uuid) IS
  'Company MTS SKU list via the production name/code rule (no FK exists SKU→Prodshade). match_count > 1 = ambiguous.';

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Effective monthly demand
-- ───────────────────────────────────────────────────────────────────────────
-- NULL means "no plan entered" (distinct from an entered 0).
CREATE OR REPLACE FUNCTION erp_planning.customer_plan_effective(
  p_company_id uuid,
  p_months     date[]
)
RETURNS TABLE (
  plan_month            date,
  sku_material_id       uuid,
  rolling_qty           numeric,
  final_qty             numeric,
  additional_qty        numeric,
  urgent_extra_qty      numeric,
  urgent_from_plan_qty  numeric,
  base_source           text,
  effective_qty         numeric,
  has_legacy_source     boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH live AS (
    SELECT l.*
    FROM erp_planning.customer_plan_line l
    WHERE l.company_id = p_company_id
      AND l.plan_month = ANY (p_months)
      AND l.is_current
      AND NOT l.is_cancelled
  ),
  agg AS (
    SELECT
      plan_month,
      sku_material_id,
      sum(base_qty) FILTER (WHERE plan_type = 'ROLLING')                              AS rolling_qty,
      sum(base_qty) FILTER (WHERE plan_type = 'FINAL')                                AS final_qty,
      sum(base_qty) FILTER (WHERE plan_type = 'ADDITIONAL')                           AS additional_qty,
      sum(base_qty) FILTER (WHERE plan_type = 'URGENT' AND urgent_mode = 'EXTRA')     AS urgent_extra_qty,
      sum(base_qty) FILTER (WHERE plan_type = 'URGENT' AND urgent_mode = 'FROM_PLAN') AS urgent_from_plan_qty,
      bool_or(source_system = 'LEGACY_GOOGLE_SHEETS')                                 AS has_legacy_source
    FROM live
    GROUP BY plan_month, sku_material_id
  )
  SELECT
    a.plan_month,
    a.sku_material_id,
    a.rolling_qty,
    a.final_qty,
    a.additional_qty,
    a.urgent_extra_qty,
    a.urgent_from_plan_qty,
    CASE WHEN a.final_qty IS NOT NULL THEN 'FINAL'
         WHEN a.rolling_qty IS NOT NULL THEN 'ROLLING' END,
    CASE WHEN a.final_qty IS NULL AND a.rolling_qty IS NULL
              AND a.additional_qty IS NULL AND a.urgent_extra_qty IS NULL THEN NULL
         ELSE coalesce(a.final_qty, a.rolling_qty, 0)
              + coalesce(a.additional_qty, 0)
              + coalesce(a.urgent_extra_qty, 0) END,
    a.has_legacy_source
  FROM agg a;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5a. Save Tab 1 lines (atomic)
-- ───────────────────────────────────────────────────────────────────────────
-- p_lines: [{ entry_id?, sku_material_id, entered_qty, entered_uom_code,
--             base_qty, base_uom_code, urgent_mode?, urgent_from_date?,
--             urgent_to_date?, remarks?, cancel? }]
-- The backend computes base_qty from verified master conversions before
-- calling; this function re-checks base_uom_code against the SKU master.
CREATE OR REPLACE FUNCTION erp_planning.save_customer_plan_lines(
  p_company_id uuid,
  p_plan_month date,
  p_plan_type  text,
  p_actor      uuid,
  p_lines      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch      uuid := gen_random_uuid();
  v_line       jsonb;
  v_sku        uuid;
  v_entry      uuid;
  v_cancel     boolean;
  v_qty        numeric;
  v_base_qty   numeric;
  v_base_uom   text;
  v_mode       text;
  v_from       date;
  v_to         date;
  v_remarks    text;
  v_current    erp_planning.customer_plan_line%ROWTYPE;
  v_saved      integer := 0;
  v_unchanged  integer := 0;
  v_touched    uuid[] := ARRAY[]::uuid[];
  v_violation  record;
BEGIN
  IF p_company_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_INPUT: company and actor are required';
  END IF;
  IF p_plan_month IS NULL OR p_plan_month <> date_trunc('month', p_plan_month)::date THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_MONTH: plan month must be the first day of a month';
  END IF;
  IF p_plan_type NOT IN ('ROLLING', 'FINAL', 'ADDITIONAL', 'URGENT') THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_TYPE: %', p_plan_type;
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'MTS_PLAN_NO_LINES: nothing to save';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_sku      := nullif(v_line->>'sku_material_id', '')::uuid;
    v_entry    := nullif(v_line->>'entry_id', '')::uuid;
    v_cancel   := coalesce((v_line->>'cancel')::boolean, false);
    v_qty      := (v_line->>'entered_qty')::numeric;
    v_base_qty := (v_line->>'base_qty')::numeric;
    v_base_uom := v_line->>'base_uom_code';
    v_mode     := nullif(v_line->>'urgent_mode', '');
    v_from     := nullif(v_line->>'urgent_from_date', '')::date;
    v_to       := nullif(v_line->>'urgent_to_date', '')::date;
    v_remarks  := nullif(btrim(coalesce(v_line->>'remarks', '')), '');

    IF v_sku IS NULL THEN
      RAISE EXCEPTION 'MTS_PLAN_SKU_REQUIRED';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM erp_planning.mts_company_skus(p_company_id) s
      WHERE s.sku_material_id = v_sku AND s.match_count = 1
    ) THEN
      RAISE EXCEPTION 'MTS_PLAN_SKU_NOT_IN_COMPANY: SKU % is not an MTS SKU of this company', v_sku;
    END IF;
    IF NOT v_cancel THEN
      IF v_qty IS NULL OR v_qty < 0 OR v_base_qty IS NULL OR v_base_qty < 0 THEN
        RAISE EXCEPTION 'MTS_PLAN_QTY_INVALID: SKU %', v_sku;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM erp_master.material_master m WHERE m.id = v_sku AND m.base_uom_code = v_base_uom
      ) THEN
        RAISE EXCEPTION 'MTS_PLAN_BASE_UOM_MISMATCH: SKU %', v_sku;
      END IF;
    END IF;
    IF p_plan_type = 'URGENT' AND NOT v_cancel THEN
      IF v_mode NOT IN ('FROM_PLAN', 'EXTRA') OR v_from IS NULL OR v_to IS NULL OR v_from > v_to THEN
        RAISE EXCEPTION 'MTS_PLAN_URGENT_PERIOD_INVALID: SKU % needs a mode and a From<=To period', v_sku;
      END IF;
    ELSIF p_plan_type <> 'URGENT' THEN
      v_mode := NULL; v_from := NULL; v_to := NULL;
    END IF;

    -- Locate the current version this line revises (if any).
    v_current := NULL;
    IF p_plan_type IN ('ROLLING', 'FINAL') THEN
      SELECT * INTO v_current
      FROM erp_planning.customer_plan_line
      WHERE company_id = p_company_id AND plan_month = p_plan_month
        AND plan_type = p_plan_type AND sku_material_id = v_sku AND is_current
      FOR UPDATE;
    ELSIF v_entry IS NOT NULL THEN
      SELECT * INTO v_current
      FROM erp_planning.customer_plan_line
      WHERE entry_id = v_entry AND is_current
      FOR UPDATE;
      IF v_current.id IS NULL
         OR v_current.company_id <> p_company_id
         OR v_current.plan_month <> p_plan_month
         OR v_current.plan_type <> p_plan_type
         OR v_current.sku_material_id <> v_sku THEN
        RAISE EXCEPTION 'MTS_PLAN_ENTRY_NOT_FOUND: entry % does not belong to this company/month/type/SKU', v_entry;
      END IF;
    END IF;

    IF v_cancel THEN
      IF v_current.id IS NULL THEN
        RAISE EXCEPTION 'MTS_PLAN_ENTRY_NOT_FOUND: nothing to cancel for SKU %', v_sku;
      END IF;
      IF v_current.is_cancelled THEN
        v_unchanged := v_unchanged + 1;
        CONTINUE;
      END IF;
      v_qty := v_current.entered_qty; v_base_qty := v_current.base_qty; v_base_uom := v_current.base_uom_code;
      v_mode := v_current.urgent_mode; v_from := v_current.urgent_from_date; v_to := v_current.urgent_to_date;
    ELSIF v_current.id IS NOT NULL
      AND NOT v_current.is_cancelled
      AND v_current.entered_qty = v_qty
      AND v_current.entered_uom_code = (v_line->>'entered_uom_code')
      AND v_current.base_qty = v_base_qty
      AND v_current.urgent_mode IS NOT DISTINCT FROM v_mode
      AND v_current.urgent_from_date IS NOT DISTINCT FROM v_from
      AND v_current.urgent_to_date IS NOT DISTINCT FROM v_to
      AND v_current.remarks IS NOT DISTINCT FROM v_remarks THEN
      v_unchanged := v_unchanged + 1;
      CONTINUE;
    END IF;

    IF v_current.id IS NOT NULL THEN
      UPDATE erp_planning.customer_plan_line SET is_current = false WHERE id = v_current.id;
    END IF;

    INSERT INTO erp_planning.customer_plan_line (
      entry_id, version_no, is_current, company_id, plan_month, plan_type,
      urgent_mode, urgent_from_date, urgent_to_date, sku_material_id,
      entered_qty, entered_uom_code, base_qty, base_uom_code, is_cancelled,
      remarks, source_system, save_batch_id, created_by
    ) VALUES (
      coalesce(v_current.entry_id, gen_random_uuid()),
      coalesce(v_current.version_no, 0) + 1,
      true, p_company_id, p_plan_month, p_plan_type,
      v_mode, v_from, v_to, v_sku,
      v_qty, CASE WHEN v_cancel THEN v_current.entered_uom_code ELSE v_line->>'entered_uom_code' END,
      v_base_qty, v_base_uom, v_cancel,
      coalesce(v_remarks, CASE WHEN v_cancel THEN v_current.remarks END),
      'ERP_ENTRY', v_batch, p_actor
    );
    v_saved := v_saved + 1;
    v_touched := array_append(v_touched, v_sku);
  END LOOP;

  -- Urgent FROM_PLAN only re-phases existing demand: its total may never
  -- exceed (FINAL else ROLLING) + ADDITIONAL for the same company×month×SKU.
  -- Checked after all lines so a reduction of the base that strands an
  -- existing FROM_PLAN allocation is rejected too (whole save rolls back).
  SELECT e.sku_material_id, e.urgent_from_plan_qty,
         coalesce(e.final_qty, e.rolling_qty, 0) + coalesce(e.additional_qty, 0) AS pool
    INTO v_violation
  FROM erp_planning.customer_plan_effective(p_company_id, ARRAY[p_plan_month]) e
  WHERE e.sku_material_id = ANY (v_touched)
    AND coalesce(e.urgent_from_plan_qty, 0)
        > coalesce(e.final_qty, e.rolling_qty, 0) + coalesce(e.additional_qty, 0)
  LIMIT 1;
  IF v_violation.sku_material_id IS NOT NULL THEN
    RAISE EXCEPTION 'MTS_PLAN_URGENT_FROM_PLAN_EXCEEDS: SKU % urgent-from-plan % exceeds plan % (base + additional)',
      v_violation.sku_material_id, v_violation.urgent_from_plan_qty, v_violation.pool;
  END IF;

  RETURN jsonb_build_object('save_batch_id', v_batch, 'saved', v_saved, 'unchanged', v_unchanged);
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5b. Save Tab 2 setting (atomic, versioned)
-- ───────────────────────────────────────────────────────────────────────────
-- p_periods:   [{ stroke_master_id, period_from, period_to, planned_base_qty? }]
-- p_primaries: [{ stroke_master_id, material_group_id, use_primary }]
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
  v_current   erp_planning.stroke_plan_setting%ROWTYPE;
  v_setting   uuid;
  v_period    jsonb;
  v_primary   jsonb;
  v_stroke    uuid;
  v_from      date;
  v_to        date;
  v_group     uuid;
  v_order     integer := 0;
  v_overlap   integer;
BEGIN
  IF p_company_id IS NULL OR p_actor IS NULL OR p_prodshade_material_id IS NULL THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_INPUT: company, prodshade and actor are required';
  END IF;
  IF p_plan_month IS NULL OR p_plan_month <> date_trunc('month', p_plan_month)::date THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_MONTH: plan month must be the first day of a month';
  END IF;
  IF jsonb_typeof(p_periods) <> 'array' OR jsonb_array_length(p_periods) = 0 THEN
    RAISE EXCEPTION 'MTS_PLAN_STROKE_PERIOD_REQUIRED: at least one stroke period is required';
  END IF;
  IF jsonb_typeof(coalesce(p_primaries, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_INPUT: primaries must be an array';
  END IF;

  SELECT * INTO v_current
  FROM erp_planning.stroke_plan_setting
  WHERE company_id = p_company_id AND plan_month = p_plan_month
    AND prodshade_material_id = p_prodshade_material_id AND is_current
  FOR UPDATE;
  IF v_current.id IS NOT NULL THEN
    UPDATE erp_planning.stroke_plan_setting SET is_current = false WHERE id = v_current.id;
  END IF;

  INSERT INTO erp_planning.stroke_plan_setting (
    company_id, plan_month, prodshade_material_id, version_no, is_current, remarks, created_by
  ) VALUES (
    p_company_id, p_plan_month, p_prodshade_material_id,
    coalesce(v_current.version_no, 0) + 1, true, nullif(btrim(coalesce(p_remarks, '')), ''), p_actor
  ) RETURNING id INTO v_setting;

  FOR v_period IN SELECT * FROM jsonb_array_elements(p_periods) LOOP
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
    IF (v_period ? 'planned_base_qty') AND nullif(v_period->>'planned_base_qty', '') IS NOT NULL
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

  FOR v_primary IN SELECT * FROM jsonb_array_elements(coalesce(p_primaries, '[]'::jsonb)) LOOP
    v_stroke := nullif(v_primary->>'stroke_master_id', '')::uuid;
    v_group  := nullif(v_primary->>'material_group_id', '')::uuid;
    IF v_stroke IS NULL OR v_group IS NULL OR (v_primary->>'use_primary') IS NULL THEN
      RAISE EXCEPTION 'MTS_PLAN_PRIMARY_INVALID: stroke, group and use_primary are required';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM erp_planning.stroke_plan_period p
      WHERE p.setting_id = v_setting AND p.stroke_master_id = v_stroke
    ) THEN
      RAISE EXCEPTION 'MTS_PLAN_PRIMARY_STROKE_NOT_IN_PERIODS: stroke % has no period in this setting', v_stroke;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM erp_production.stroke_line l
      WHERE l.stroke_master_id = v_stroke AND l.material_group_id = v_group
    ) THEN
      RAISE EXCEPTION 'MTS_PLAN_PRIMARY_GROUP_NOT_IN_STROKE: group % is not an RM group of stroke %', v_group, v_stroke;
    END IF;
    INSERT INTO erp_planning.stroke_plan_group_primary (setting_id, stroke_master_id, material_group_id, use_primary)
    VALUES (v_setting, v_stroke, v_group, (v_primary->>'use_primary')::boolean);
  END LOOP;

  RETURN jsonb_build_object('setting_id', v_setting, 'version_no', coalesce(v_current.version_no, 0) + 1);
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Grants (backend service role only; RLS on, no policies = no direct client access)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE erp_planning.customer_plan_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_planning.stroke_plan_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_planning.stroke_plan_period ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_planning.stroke_plan_group_primary ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON erp_planning.customer_plan_line TO service_role;
GRANT SELECT, INSERT, UPDATE ON erp_planning.stroke_plan_setting TO service_role;
GRANT SELECT, INSERT ON erp_planning.stroke_plan_period TO service_role;
GRANT SELECT, INSERT ON erp_planning.stroke_plan_group_primary TO service_role;

REVOKE ALL ON FUNCTION erp_planning.mts_company_skus(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_planning.customer_plan_effective(uuid, date[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_planning.save_customer_plan_lines(uuid, date, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_planning.save_stroke_plan_setting(uuid, date, uuid, uuid, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.mts_company_skus(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION erp_planning.customer_plan_effective(uuid, date[]) TO service_role;
GRANT EXECUTE ON FUNCTION erp_planning.save_customer_plan_lines(uuid, date, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION erp_planning.save_stroke_plan_setting(uuid, date, uuid, uuid, jsonb, jsonb, text) TO service_role;

COMMIT;
