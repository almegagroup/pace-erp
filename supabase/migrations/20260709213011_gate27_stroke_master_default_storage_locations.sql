/*
 * Migration: 20260709213011_gate27_stroke_master_default_storage_locations
 * Gate: 27.2
 * Purpose: Default Storage Location per RM/INT line and per Prodshade (SFG/INT
 *          output) on Stroke Master. Used at Process PO Final/Verify to scope
 *          the unrestricted-stock check and consumption/production posting to
 *          a single default location per material, company-mapped.
 */

BEGIN;

ALTER TABLE erp_production.stroke_master
  ADD COLUMN IF NOT EXISTS default_storage_location_id uuid NULL;

ALTER TABLE erp_production.stroke_line
  ADD COLUMN IF NOT EXISTS default_storage_location_id uuid NULL;

COMMIT;
