/*
 * Migration: 20261020120000_po21_plan_production_company
 * Purpose:   PO21 cross-company production (owner 2026-10-20).
 *            A company's MTS plan (e.g. CMP005) can be made at another company
 *            (e.g. CMP003): CMP003 makes it, sells it to CMP005, CMP005 dispatches.
 *            The plan stays in the owning company; this table only says, per
 *            company × month × SKU, which company produces it. All plan types of
 *            that SKU-month follow it (no split; owner accepted "one line, one
 *            company"). The producing company's PO22 Requirement / Planning carries
 *            that demand; the owning company's does not.
 *            Set by the procurement team (ACL companion PROC_MTS_PLAN_PRODUCTION_COMPANY).
 *
 *   1. customer_plan_production_company — append-only, versioned (same model as
 *      customer_plan_line); production_company_id NULL = made at the owner itself.
 *   2. save_customer_plan_production_company() — atomic save; the SKU must be a
 *      resolved MTS SKU of both the owner and the producing company.
 *   3. customer_plan_effective_incoming() — effective monthly plan of other
 *      companies that the given company produces (for its PO21 report).
 *
 * After applying: NOTIFY pgrst, 'reload schema'; run migration-integrity-check.
 */

BEGIN;

CREATE TABLE erp_planning.customer_plan_production_company (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES erp_master.companies(id),
  plan_month            date NOT NULL CHECK (plan_month = date_trunc('month', plan_month)::date),
  sku_material_id       uuid NOT NULL REFERENCES erp_master.material_master(id),
  production_company_id uuid REFERENCES erp_master.companies(id),
  version_no            integer NOT NULL CHECK (version_no >= 1),
  is_current            boolean NOT NULL DEFAULT true,
  remarks               text,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_plan_production_company_not_self CHECK (production_company_id IS NULL OR production_company_id <> company_id)
);

COMMENT ON TABLE erp_planning.customer_plan_production_company IS
  'PO21: which company produces a company''s MTS plan for a month × SKU (NULL = the owner). Append-only versions; the producing company carries the demand in PO22.';

CREATE UNIQUE INDEX ux_plan_production_company_current
  ON erp_planning.customer_plan_production_company (company_id, plan_month, sku_material_id) WHERE is_current;
CREATE INDEX ix_plan_production_company_producer
  ON erp_planning.customer_plan_production_company (production_company_id, plan_month) WHERE is_current;

CREATE TRIGGER trg_plan_production_company_append_only
  BEFORE UPDATE OR DELETE ON erp_planning.customer_plan_production_company
  FOR EACH ROW EXECUTE FUNCTION erp_planning.guard_append_only();

-- p_rows: [{ sku_material_id, production_company_id (null/'' = own company), remarks? }]
CREATE OR REPLACE FUNCTION erp_planning.save_customer_plan_production_company(
  p_company_id uuid,
  p_plan_month date,
  p_actor      uuid,
  p_rows       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row       jsonb;
  v_sku       uuid;
  v_producer  uuid;
  v_remarks   text;
  v_current   erp_planning.customer_plan_production_company%ROWTYPE;
  v_saved     integer := 0;
  v_unchanged integer := 0;
BEGIN
  IF p_company_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_INPUT: company and actor are required';
  END IF;
  IF p_plan_month IS NULL OR p_plan_month <> date_trunc('month', p_plan_month)::date THEN
    RAISE EXCEPTION 'MTS_PLAN_INVALID_MONTH: plan month must be the first day of a month';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'MTS_PLAN_NO_LINES: nothing to save';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_sku      := nullif(v_row->>'sku_material_id', '')::uuid;
    v_producer := nullif(v_row->>'production_company_id', '')::uuid;
    v_remarks  := nullif(btrim(coalesce(v_row->>'remarks', '')), '');
    IF v_sku IS NULL THEN
      RAISE EXCEPTION 'MTS_PLAN_SKU_REQUIRED';
    END IF;
    IF v_producer = p_company_id THEN
      v_producer := NULL; -- own company = no cross-company production
    END IF;
    IF NOT EXISTS (SELECT 1 FROM erp_planning.mts_company_skus(p_company_id) s WHERE s.sku_material_id = v_sku AND s.match_count = 1) THEN
      RAISE EXCEPTION 'MTS_PLAN_SKU_NOT_IN_COMPANY: SKU % is not an MTS SKU of this company', v_sku;
    END IF;
    IF v_producer IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM erp_master.companies c WHERE c.id = v_producer) THEN
        RAISE EXCEPTION 'MTS_PLAN_PRODUCTION_COMPANY_INVALID: %', v_producer;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM erp_planning.mts_company_skus(v_producer) s WHERE s.sku_material_id = v_sku AND s.match_count = 1) THEN
        RAISE EXCEPTION 'MTS_PLAN_PRODUCTION_SKU_MISSING: SKU % has no MTS stroke / pack setup in the producing company', v_sku;
      END IF;
    END IF;

    SELECT * INTO v_current FROM erp_planning.customer_plan_production_company
    WHERE company_id = p_company_id AND plan_month = p_plan_month AND sku_material_id = v_sku AND is_current
    FOR UPDATE;

    IF (v_current.id IS NULL AND v_producer IS NULL)
       OR (v_current.id IS NOT NULL AND v_current.production_company_id IS NOT DISTINCT FROM v_producer) THEN
      v_unchanged := v_unchanged + 1;
      CONTINUE;
    END IF;
    IF v_current.id IS NOT NULL THEN
      UPDATE erp_planning.customer_plan_production_company SET is_current = false WHERE id = v_current.id;
    END IF;
    INSERT INTO erp_planning.customer_plan_production_company
      (company_id, plan_month, sku_material_id, production_company_id, version_no, is_current, remarks, created_by)
    VALUES (p_company_id, p_plan_month, v_sku, v_producer, coalesce(v_current.version_no, 0) + 1, true, v_remarks, p_actor);
    v_saved := v_saved + 1;
  END LOOP;

  RETURN jsonb_build_object('saved', v_saved, 'unchanged', v_unchanged);
END;
$$;

-- Effective plan (same rule as customer_plan_effective) of other companies' SKU-months
-- that p_production_company currently produces.
CREATE OR REPLACE FUNCTION erp_planning.customer_plan_effective_incoming(
  p_production_company uuid,
  p_months             date[]
)
RETURNS TABLE (
  source_company_id     uuid,
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
  WITH assigned AS (
    SELECT a.company_id, a.plan_month, a.sku_material_id
    FROM erp_planning.customer_plan_production_company a
    WHERE a.production_company_id = p_production_company AND a.is_current AND a.plan_month = ANY (p_months)
  ),
  live AS (
    SELECT l.*
    FROM erp_planning.customer_plan_line l
    JOIN assigned a ON a.company_id = l.company_id AND a.plan_month = l.plan_month AND a.sku_material_id = l.sku_material_id
    WHERE l.is_current AND NOT l.is_cancelled
  ),
  agg AS (
    SELECT
      company_id, plan_month, sku_material_id,
      sum(base_qty) FILTER (WHERE plan_type = 'ROLLING')                              AS rolling_qty,
      sum(base_qty) FILTER (WHERE plan_type = 'FINAL')                                AS final_qty,
      sum(base_qty) FILTER (WHERE plan_type = 'ADDITIONAL')                           AS additional_qty,
      sum(base_qty) FILTER (WHERE plan_type = 'URGENT' AND urgent_mode = 'EXTRA')     AS urgent_extra_qty,
      sum(base_qty) FILTER (WHERE plan_type = 'URGENT' AND urgent_mode = 'FROM_PLAN') AS urgent_from_plan_qty,
      bool_or(source_system = 'LEGACY_GOOGLE_SHEETS')                                 AS has_legacy_source
    FROM live
    GROUP BY company_id, plan_month, sku_material_id
  )
  SELECT
    a.company_id, a.plan_month, a.sku_material_id,
    a.rolling_qty, a.final_qty, a.additional_qty, a.urgent_extra_qty, a.urgent_from_plan_qty,
    CASE WHEN a.final_qty IS NOT NULL THEN 'FINAL' WHEN a.rolling_qty IS NOT NULL THEN 'ROLLING' END,
    CASE WHEN a.final_qty IS NULL AND a.rolling_qty IS NULL AND a.additional_qty IS NULL AND a.urgent_extra_qty IS NULL THEN NULL
         ELSE coalesce(a.final_qty, a.rolling_qty, 0) + coalesce(a.additional_qty, 0) + coalesce(a.urgent_extra_qty, 0) END,
    a.has_legacy_source
  FROM agg a;
$$;

ALTER TABLE erp_planning.customer_plan_production_company ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON erp_planning.customer_plan_production_company TO service_role;
REVOKE ALL ON FUNCTION erp_planning.save_customer_plan_production_company(uuid, date, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_planning.customer_plan_effective_incoming(uuid, date[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.save_customer_plan_production_company(uuid, date, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION erp_planning.customer_plan_effective_incoming(uuid, date[]) TO service_role;

COMMIT;
