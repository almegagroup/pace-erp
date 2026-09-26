/*
 * File-Path: supabase/migrations/20260926090000_vendor_duplicate_check_similarity_fn.sql
 * Purpose: Vendor Create duplicate-check. A GST-bearing vendor is matched by
 *          exact GST Number (done in application code -- a plain .eq()/.ilike()
 *          needs no SQL function). A non-GST vendor has no such reliable key,
 *          so this adds a name-similarity lookup the application code calls
 *          via RPC, reusing the pg_trgm extension + GIN index already added
 *          by migration 20260709120000_vendor_material_search_trgm_indexes.sql
 *          (that migration only indexed vendor_name for ILIKE search; this
 *          one is the first caller of pg_trgm's similarity() against it).
 */

BEGIN;

CREATE OR REPLACE FUNCTION erp_master.find_similar_vendor_names(
  p_name text,
  p_vendor_type text DEFAULT NULL,
  p_threshold real DEFAULT 0.35,
  p_limit integer DEFAULT 5
)
RETURNS SETOF erp_master.vendor_master
LANGUAGE sql
STABLE
AS $$
  SELECT vm.*
  FROM erp_master.vendor_master vm
  WHERE (p_vendor_type IS NULL OR vm.vendor_type = p_vendor_type)
    AND extensions.similarity(vm.vendor_name, p_name) >= p_threshold
  ORDER BY extensions.similarity(vm.vendor_name, p_name) DESC
  LIMIT p_limit;
$$;

COMMIT;
