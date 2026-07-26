/*
 * Migration: 20260709211641_gate27_stroke_master_new_prodshade_support
 * Gate: 27.2
 * Purpose: Support creating a brand-new Prodshade (Prod+Shade combo) directly
 *          from Stroke Master, per feasibility doc 83.3 — Material Master
 *          creation is deferred to PR02 Approve, so prodshade_material_id must
 *          be nullable at DRAFT time while prod_code/shade_code are captured.
 */

BEGIN;

ALTER TABLE erp_production.stroke_master
  ALTER COLUMN prodshade_material_id DROP NOT NULL;

ALTER TABLE erp_production.stroke_master
  ADD COLUMN IF NOT EXISTS prod_code text NULL,
  ADD COLUMN IF NOT EXISTS shade_code text NULL;

COMMIT;
