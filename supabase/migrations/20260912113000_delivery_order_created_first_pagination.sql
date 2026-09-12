-- Delivery-order queue pagination with the existing actionable-first ordering.
--
-- SO02 keeps CREATED delivery orders at the top, then sorts those action items
-- by DO date ascending and completed work by date descending. PostgREST cannot
-- express that CASE ordering, so this small, read-only RPC returns just the
-- ordered page IDs and the exact filtered count. The API handler loads and
-- enriches those IDs using its existing company-scoped path.

CREATE OR REPLACE FUNCTION erp_procurement.list_delivery_order_page(
  p_company_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_created_first boolean DEFAULT false
)
RETURNS TABLE (delivery_order_id uuid, total_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH filtered AS (
    SELECT dc.id, dc.status, dc.dc_date, dc.created_at
    FROM erp_procurement.delivery_challan AS dc
    WHERE dc.dc_type = ANY (ARRAY['SALES', 'STO'])
      AND (p_company_id IS NULL OR dc.selling_company_id = p_company_id)
      AND (NULLIF(BTRIM(p_status), '') IS NULL OR dc.status = UPPER(BTRIM(p_status)))
      AND (NULLIF(BTRIM(p_search), '') IS NULL OR dc.dc_number ILIKE '%' || BTRIM(p_search) || '%')
  ), numbered AS (
    SELECT
      id,
      status,
      dc_date,
      created_at,
      COUNT(*) OVER () AS total_count,
      CASE WHEN p_created_first AND status = 'CREATED' THEN 0 ELSE 1 END AS priority_rank
    FROM filtered
  )
  SELECT id, total_count
  FROM numbered
  ORDER BY
    priority_rank ASC,
    CASE WHEN p_created_first AND status = 'CREATED' THEN dc_date END ASC NULLS LAST,
    CASE WHEN p_created_first AND status <> 'CREATED' THEN dc_date END DESC NULLS LAST,
    CASE WHEN NOT p_created_first THEN created_at END DESC NULLS LAST,
    created_at DESC,
    id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION erp_procurement.list_delivery_order_page(uuid, text, text, integer, integer, boolean) TO service_role;
