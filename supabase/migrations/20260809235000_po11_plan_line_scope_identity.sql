/*
 * File-Path: supabase/migrations/20260809235000_po11_plan_line_scope_identity.sql
 * Purpose: Re-scope PO11 monthly plan line identity to plan + material + parent SLOC group.
 * Authority: Backend
 */

BEGIN;

UPDATE erp_procurement.procurement_monthly_plan_line line
SET source_sloc_group_id = ig.sloc_group_id
FROM erp_procurement.planning_item_group ig
WHERE line.planning_item_group_id = ig.id
  AND line.source_sloc_group_id IS NULL
  AND ig.sloc_group_id IS NOT NULL;

ALTER TABLE erp_procurement.procurement_monthly_plan_line
  DROP CONSTRAINT IF EXISTS procurement_monthly_plan_line_plan_id_material_id_key;

ALTER TABLE erp_procurement.procurement_monthly_plan_line
  ADD CONSTRAINT procurement_monthly_plan_line_plan_material_scope_key
  UNIQUE (plan_id, material_id, source_sloc_group_id);

CREATE INDEX IF NOT EXISTS idx_po11_plan_line_scope
  ON erp_procurement.procurement_monthly_plan_line(plan_id, source_sloc_group_id, material_id);

COMMIT;
