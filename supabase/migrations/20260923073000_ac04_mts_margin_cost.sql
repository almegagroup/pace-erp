/*
 * File-Path: supabase/migrations/20260923073000_ac04_mts_margin_cost.sql
 * Gate: 27.104 (AC04 follow-up)
 * Domain: PRODUCTION / COSTING
 * Purpose: MTS (IWC/POWDER) conversion cost splits into two components — Conversion Cost
 *          and Margin Cost (which may be negative) — with Net Conversion Cost = the sum.
 *          Only IWC/POWDER carry a margin; ADMIX/HPS/INT are untouched (margin stays NULL,
 *          resolver behavior unchanged for them). Business owner decision, 2026-09-23.
 * Authority: Backend / DB
 */

ALTER TABLE erp_production.conversion_cost_config
  ADD COLUMN IF NOT EXISTS margin_cost_per_kg numeric(20,6) NULL;

COMMENT ON COLUMN erp_production.conversion_cost_config.margin_cost_per_kg IS
  'MTS (IWC/POWDER) only. May be negative. Net Conversion Cost/KG = conversion_rate_per_kg + margin_cost_per_kg. NULL for every other segment.';

-- Guard against the margin leaking into ADMIX/HPS/INT rows.
ALTER TABLE erp_production.conversion_cost_config
  ADD CONSTRAINT conversion_cost_config_margin_scope_check
  CHECK (margin_cost_per_kg IS NULL OR segment_code IN ('IWC', 'POWDER'));

-- Resolver now returns the NET rate (conversion + margin) for IWC/POWDER; unchanged for
-- everyone else since margin_cost_per_kg is always NULL there. Process PO Verify (and any
-- other caller) needs no change — it still receives one number.
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
  SELECT conversion_rate_per_kg + COALESCE(margin_cost_per_kg, 0)
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
