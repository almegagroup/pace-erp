/*
 * File-Path: supabase/migrations/20260809235500_po11_archive_group_config_identity.sql
 * Purpose: Make archived PO11 group-config identity depend on the item-group id rather than snapshot name.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_procurement.procurement_monthly_plan_archive_group_config
  DROP CONSTRAINT IF EXISTS procurement_monthly_plan_archive_group_config_archive_id_planning_item_group_name_snapshot_key;

ALTER TABLE erp_procurement.procurement_monthly_plan_archive_group_config
  ADD CONSTRAINT procurement_monthly_plan_archive_group_config_archive_group_key
  UNIQUE (archive_id, planning_item_group_id);

DROP INDEX IF EXISTS erp_procurement.idx_po11_archive_group_config_archive;

CREATE INDEX IF NOT EXISTS idx_po11_archive_group_config_archive
  ON erp_procurement.procurement_monthly_plan_archive_group_config(archive_id, planning_item_group_id);

COMMIT;
