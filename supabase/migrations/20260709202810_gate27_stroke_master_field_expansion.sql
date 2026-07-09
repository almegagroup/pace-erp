/*
 * Migration: 20260709202810_gate27_stroke_master_field_expansion
 * Gate: 27.2
 * Purpose: Bring erp_production.stroke_master / stroke_line in line with feasibility
 *          doc Section 83.3 (revised 2026-06-30) — Material Type / PO Type header
 *          fields, UOM conversion fields, DEACTIVATED status, per-line Material Type
 *          + Material Group (replaces single alternate_material_id going forward).
 */

BEGIN;

-- ── Header fields per feasibility doc 83.3 (revised 2026-06-30) ─────────────
ALTER TABLE erp_production.stroke_master
  ADD COLUMN IF NOT EXISTS material_type text NOT NULL DEFAULT 'SFG',
  ADD COLUMN IF NOT EXISTS po_type text NOT NULL DEFAULT 'MTO',
  ADD COLUMN IF NOT EXISTS base_uom_code text NULL,
  ADD COLUMN IF NOT EXISTS conversion_uom_code text NULL,
  ADD COLUMN IF NOT EXISTS conversion_factor numeric NULL,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid NULL,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz NULL;

ALTER TABLE erp_production.stroke_master
  ADD CONSTRAINT stroke_master_material_type_check
    CHECK (material_type IN ('SFG', 'INT'));

ALTER TABLE erp_production.stroke_master
  ADD CONSTRAINT stroke_master_po_type_check
    CHECK (po_type IN ('MTO', 'HPS', 'MTS', 'INT', 'MTEST'));

ALTER TABLE erp_production.stroke_master
  ADD CONSTRAINT stroke_master_conversion_factor_check
    CHECK (conversion_factor IS NULL OR conversion_factor > 0);

-- Extend status lifecycle to include DEACTIVATED (terminal state, 83.3 Stroke Lifecycle)
ALTER TABLE erp_production.stroke_master
  DROP CONSTRAINT stroke_master_status_check;

ALTER TABLE erp_production.stroke_master
  ADD CONSTRAINT stroke_master_status_check
    CHECK (status = ANY (ARRAY['DRAFT'::text, 'APPROVED'::text, 'DEACTIVATED'::text]));

-- ── Line fields: Material Type per line + Material Group (replaces single alternate) ─
ALTER TABLE erp_production.stroke_line
  ADD COLUMN IF NOT EXISTS line_material_type text NOT NULL DEFAULT 'RM',
  ADD COLUMN IF NOT EXISTS material_group_id uuid NULL
    REFERENCES erp_master.material_category_group(id);

ALTER TABLE erp_production.stroke_line
  ADD CONSTRAINT stroke_line_material_type_check
    CHECK (line_material_type IN ('RM', 'INT'));

COMMIT;
