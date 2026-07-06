/*
 * Migration: 20260618120000_material_master_redesign
 * Purpose: Material Master redesign — rename material_group→material_category,
 *          add document_name, make pace_code nullable.
 */

BEGIN;

-- 1. Rename material_group → material_category
ALTER TABLE erp_master.material_master
  RENAME COLUMN material_group TO material_category;

-- 2. Add document_name (vendor invoice name)
ALTER TABLE erp_master.material_master
  ADD COLUMN IF NOT EXISTS document_name text NULL;

-- 3. Make pace_code nullable (can be set later, auto-generated on create)
ALTER TABLE erp_master.material_master
  ALTER COLUMN pace_code DROP NOT NULL;

COMMIT;
