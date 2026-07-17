/*
 * File-Path: supabase/migrations/20260718090000_gate27_104_conversion_cost_config.sql
 * Gate: 27.104
 * Domain: PRODUCTION / COSTING
 * Purpose: Section 104.8 — per-KG conversion-cost configuration + resolver.
 *
 *   Cost model (LOCKED §104.8): SFG value/KG = RMC/KG + Conversion/KG;
 *   FG value/KG = SFG rate + PMC/KG. This table holds the Conversion/KG piece.
 *
 *   Key = company + segment_code + (nullable) prodshade_material_id + valid_from:
 *     - prodshade_material_id NULL  → the segment default (e.g. ADMIX = 1.95/KG)
 *     - prodshade_material_id = X    → override for that Prodshade (MTS: IWC vs Powder, etc.)
 *   Resolution is "specific beats general": a Prodshade override wins over the segment default.
 *
 *   Dating (LOCKED §104.8): ONLY valid_from is stored. valid_to is DERIVED (next row's
 *   valid_from − 1) and never stored, so gaps/overlaps are impossible and no auto-update step
 *   can fail. Changing a rate = insert a new row with a new valid_from; old rows are never
 *   edited or deleted (full history). Resolution is by posting_date, so back-dated postings
 *   automatically pick the rate that was valid then.
 * Authority: Backend / DB
 */

CREATE TABLE IF NOT EXISTS erp_production.conversion_cost_config (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES erp_master.companies(id),
  segment_code           text NOT NULL,
  -- NULL = segment default; a value = Prodshade-specific override.
  prodshade_material_id  uuid REFERENCES erp_master.material_master(id),
  valid_from             date NOT NULL,
  conversion_rate_per_kg numeric(20,6) NOT NULL CHECK (conversion_rate_per_kg >= 0),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL
);

-- Exactly one segment-default row per (company, segment, valid_from).
CREATE UNIQUE INDEX IF NOT EXISTS ux_conv_segment_default
  ON erp_production.conversion_cost_config(company_id, segment_code, valid_from)
  WHERE prodshade_material_id IS NULL;

-- Exactly one Prodshade-override row per (company, segment, prodshade, valid_from).
CREATE UNIQUE INDEX IF NOT EXISTS ux_conv_prodshade_override
  ON erp_production.conversion_cost_config(company_id, segment_code, prodshade_material_id, valid_from)
  WHERE prodshade_material_id IS NOT NULL;

-- Resolver: prodshade override first, else segment default; latest valid_from <= posting date.
-- Returns NULL when no rate is configured for that date (caller hard-blocks the posting — §104.8).
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
  SELECT conversion_rate_per_kg
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
