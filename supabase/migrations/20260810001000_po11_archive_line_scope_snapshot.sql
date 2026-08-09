/*
 * File-Path: supabase/migrations/20260810001000_po11_archive_line_scope_snapshot.sql
 * Purpose: Preserve PO11 archive line identity by source SLOC scope and item-group snapshot ids.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_procurement.procurement_monthly_plan_archive_line
  ADD COLUMN IF NOT EXISTS source_sloc_group_id_snapshot uuid NULL,
  ADD COLUMN IF NOT EXISTS planning_item_group_id_snapshot uuid NULL;

ALTER TABLE erp_procurement.procurement_monthly_plan_archive_line
  DROP CONSTRAINT IF EXISTS procurement_monthly_plan_archive_line_archive_id_material_id_key;

ALTER TABLE erp_procurement.procurement_monthly_plan_archive_line
  ADD CONSTRAINT procurement_monthly_plan_archive_line_archive_scope_key
  UNIQUE (archive_id, material_id, source_sloc_group_id_snapshot);

CREATE INDEX IF NOT EXISTS idx_po11_archive_line_scope
  ON erp_procurement.procurement_monthly_plan_archive_line(archive_id, source_sloc_group_id_snapshot, display_order);

COMMIT;
