/*
 * File-Path: supabase/migrations/20260709120000_vendor_material_search_trgm_indexes.sql
 * Purpose: vendor/material search (VMI list, material list) uses leading-wildcard
 *          ilike '%term%' filters, which a plain btree index cannot accelerate —
 *          add pg_trgm GIN indexes so Postgres can use them for these queries.
 *          No application code change needed; the planner picks these up automatically.
 */

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_vendor_master_vendor_code_trgm
  ON erp_master.vendor_master USING gin (vendor_code extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_vendor_master_vendor_name_trgm
  ON erp_master.vendor_master USING gin (vendor_name extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_material_master_pace_code_trgm
  ON erp_master.material_master USING gin (pace_code extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_material_master_material_name_trgm
  ON erp_master.material_master USING gin (material_name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_material_master_external_code_trgm
  ON erp_master.material_master USING gin (external_code extensions.gin_trgm_ops);

COMMIT;
