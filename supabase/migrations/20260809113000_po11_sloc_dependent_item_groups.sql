/*
 * File-Path: supabase/migrations/20260809113000_po11_sloc_dependent_item_groups.sql
 * Purpose: Make PO11 planning item groups explicitly dependent on planning SLOC groups.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_procurement.planning_item_group
  ADD COLUMN IF NOT EXISTS sloc_group_id uuid NULL
  REFERENCES erp_procurement.planning_sloc_group(id);

CREATE INDEX IF NOT EXISTS idx_po11_item_group_sloc_group
  ON erp_procurement.planning_item_group(sloc_group_id, company_id, group_name);

COMMIT;
