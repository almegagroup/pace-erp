/*
 * Gate: 27.27 (Costing / Dispatch prerequisite)
 * Purpose: Asian-Paints-assigned "Vendor Code" (PACE's own identity within
 *          Asian Paints' system, distinct from erp_procurement.vendor_master
 *          which is PACE's RM/PM suppliers) -- feasibility doc Section 140.
 *          A vendor code is a GLOBAL entity (SA creates it; the same code can
 *          be shared across PACE companies). Each company then maps which
 *          vendor codes actually apply to it, picks exactly one as Primary
 *          (the default for every Prodshade/Stroke not explicitly overridden),
 *          and may override specific Prodshade+Stroke combinations onto a
 *          non-primary vendor code.
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_production.vendor_code_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_code text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  UNIQUE (vendor_code)
);

CREATE TABLE IF NOT EXISTS erp_production.company_vendor_code_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  vendor_code_id uuid NOT NULL REFERENCES erp_production.vendor_code_master(id),
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  UNIQUE (company_id, vendor_code_id)
);

-- Exactly one active Primary per company -- enforced at the DB level, not
-- just in the handler, so a race between two saves can never leave a
-- company with zero or two primaries.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_vendor_code_primary
  ON erp_production.company_vendor_code_map (company_id)
  WHERE is_primary AND active;

CREATE INDEX IF NOT EXISTS idx_company_vendor_code_map_company
  ON erp_production.company_vendor_code_map (company_id, active);

CREATE TABLE IF NOT EXISTS erp_production.vendor_code_stroke_override (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  company_vendor_code_map_id uuid NOT NULL REFERENCES erp_production.company_vendor_code_map(id) ON DELETE CASCADE,
  stroke_master_id uuid NOT NULL REFERENCES erp_production.stroke_master(id),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  -- One Stroke can only ever be overridden onto ONE vendor code at a time --
  -- a second override for the same Stroke must replace, not add.
  UNIQUE (company_id, stroke_master_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_code_stroke_override_map
  ON erp_production.vendor_code_stroke_override (company_vendor_code_map_id);

COMMIT;
