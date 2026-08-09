/*
 * File-Path: supabase/migrations/20260809124500_po11_item_group_scope_uniqueness.sql
 * Purpose: Scope PO11 item-group uniqueness under the parent SLOC group.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_procurement.planning_item_group
  DROP CONSTRAINT IF EXISTS planning_item_group_company_id_group_name_key;

ALTER TABLE erp_procurement.planning_item_group
  ADD CONSTRAINT planning_item_group_company_sloc_group_name_key
  UNIQUE (company_id, sloc_group_id, group_name);

DROP INDEX IF EXISTS erp_procurement.idx_po11_item_group_company;

CREATE INDEX IF NOT EXISTS idx_po11_item_group_company_scope
  ON erp_procurement.planning_item_group(company_id, sloc_group_id, group_name);

COMMIT;
