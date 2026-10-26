/*
 * Migration: 20261026140000_po21_production_company_carry_forward
 * Purpose:   PO21 cross-company production — a producing-company choice carries forward
 *            (owner 2026-10-26). PROD had the choice saved for 2026-10 only (13 SKUs,
 *            CMP005 -> CMP003), so Nov/Dec/Jan of the same SKUs were still planned at CMP005.
 *
 *   The choice saved for a SKU in one plan month stays in force for every later month
 *   until a newer choice (another company, or "own company" = NULL) is saved for that SKU.
 *   customer_plan_effective_incoming() now resolves the producer per requested month that way.
 *   Table, save function and RLS are unchanged; planning-only data.
 *
 *   After applying: NOTIFY pgrst, 'reload schema'; reconcile schema_migrations to this
 *   file's version; run migration-integrity-check.
 */
BEGIN;

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
  WITH months AS (
    SELECT DISTINCT m AS plan_month FROM unnest(p_months) AS m
  ),
  -- latest current choice at or before each requested month, per owner company x SKU
  resolved AS (
    SELECT DISTINCT ON (a.company_id, a.sku_material_id, mo.plan_month)
           a.company_id, mo.plan_month, a.sku_material_id, a.production_company_id
    FROM months mo
    JOIN erp_planning.customer_plan_production_company a
      ON a.is_current AND a.plan_month <= mo.plan_month
    ORDER BY a.company_id, a.sku_material_id, mo.plan_month, a.plan_month DESC
  ),
  assigned AS (
    SELECT r.company_id, r.plan_month, r.sku_material_id
    FROM resolved r
    WHERE r.production_company_id = p_production_company
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

REVOKE ALL ON FUNCTION erp_planning.customer_plan_effective_incoming(uuid, date[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.customer_plan_effective_incoming(uuid, date[]) TO service_role;

COMMIT;
