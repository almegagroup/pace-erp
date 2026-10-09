BEGIN;

-- §6 point 9 — SO Map bulk Customer resolution (no-GST case): a name-only
-- match is unsafe at scale (true duplicates and coincidental name-collisions
-- both exist in real data, §6 point 6's finding), so this is VDC-scoped from
-- the start -- a candidate only counts if one of its customer_address rows
-- is mapped to the SAME VDC as the SO being resolved (depot_code_id).
-- Mirrors 20260926090000_vendor_duplicate_check_similarity_fn.sql's
-- established pg_trgm pattern (same extension, same similarity() call).
CREATE INDEX IF NOT EXISTS idx_customer_master_customer_name_trgm
  ON erp_master.customer_master USING gin (customer_name extensions.gin_trgm_ops);

CREATE OR REPLACE FUNCTION erp_master.find_similar_customer_names_in_vdc(
  p_name text,
  p_depot_code_id uuid,
  p_threshold real DEFAULT 0.35,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  customer_id text,
  customer_name text,
  customer_address_id text,
  site_name text,
  address_line text,
  town text,
  state text,
  similarity_score real
)
LANGUAGE sql
STABLE
AS $$
  SELECT cm.id::text, cm.customer_name, ca.id::text, ca.site_name, ca.address_line, ca.town, ca.state,
         extensions.similarity(cm.customer_name, p_name) AS similarity_score
  FROM erp_master.customer_master cm
  JOIN erp_master.customer_address ca
    ON ca.customer_id = cm.id
    AND ca.depot_code_id = p_depot_code_id
    AND ca.status = 'ACTIVE'
  WHERE p_depot_code_id IS NOT NULL
    AND extensions.similarity(cm.customer_name, p_name) >= p_threshold
  ORDER BY similarity_score DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION erp_master.find_similar_customer_names_in_vdc(text, uuid, real, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
