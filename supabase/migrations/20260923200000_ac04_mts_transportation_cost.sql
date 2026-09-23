/*
 * File-Path: supabase/migrations/20260923200000_ac04_mts_transportation_cost.sql
 * Gate: 27.104 (AC04 follow-up)
 * Domain: PRODUCTION / COSTING
 * Purpose: MTS (IWC/POWDER) conversion cost gets a third, optional component --
 *          Transportation Cost -- alongside the existing Conversion Cost and
 *          Margin Cost. Net Conversion Cost/KG = Conversion + Margin +
 *          Transportation. May be left blank at any entry; when a later entry
 *          for the same Prodshade is created, the current Transportation Cost
 *          pre-fills into the new row same as Conversion/Margin already do
 *          (frontend behavior, no schema change needed for that part).
 *          Business owner decision, 2026-09-23.
 * Authority: Backend / DB
 */

ALTER TABLE erp_production.conversion_cost_config
  ADD COLUMN IF NOT EXISTS transportation_cost_per_kg numeric(20,6) NULL;

COMMENT ON COLUMN erp_production.conversion_cost_config.transportation_cost_per_kg IS
  'MTS (IWC/POWDER) only, optional -- may be left NULL/blank. Net Conversion Cost/KG = conversion_rate_per_kg + margin_cost_per_kg + transportation_cost_per_kg. NULL for every other segment.';

-- Guard against transportation cost leaking into ADMIX/HPS/INT rows -- same
-- scope restriction the margin column already has.
ALTER TABLE erp_production.conversion_cost_config
  ADD CONSTRAINT conversion_cost_config_transportation_scope_check
  CHECK (transportation_cost_per_kg IS NULL OR segment_code IN ('IWC', 'POWDER'));

-- Resolver now returns Conversion + Margin + Transportation for IWC/POWDER;
-- unchanged for everyone else (both extra columns are always NULL there).
CREATE OR REPLACE FUNCTION erp_production.resolve_conversion_rate(
  p_company_id  uuid,
  p_segment_code text,
  p_prodshade_material_id uuid,
  p_posting_date date
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT conversion_rate_per_kg + COALESCE(margin_cost_per_kg, 0) + COALESCE(transportation_cost_per_kg, 0)
  FROM erp_production.conversion_cost_config
  WHERE company_id = p_company_id
    AND segment_code = p_segment_code
    AND valid_from <= p_posting_date
    AND (
      prodshade_material_id = p_prodshade_material_id
      OR prodshade_material_id IS NULL
    )
  -- Prodshade-specific (NOT NULL) ranks above the segment default; then newest valid_from.
  ORDER BY (prodshade_material_id IS NOT NULL) DESC, valid_from DESC
  LIMIT 1;
$function$;
