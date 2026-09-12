BEGIN;

-- PR14 Page 2 must search the complete, company-scoped result set before it
-- applies pagination. Doing the joins/EXISTS clauses here avoids loading every
-- matching batch into the API process merely to find a row on a later page.
CREATE OR REPLACE FUNCTION public.search_batch_variance_process_orders(
  p_company_ids uuid[] DEFAULT NULL,
  p_po_types text[] DEFAULT NULL,
  p_batch_number text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_process_order_ids uuid[] DEFAULT NULL,
  p_po_number text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 100
)
RETURNS TABLE(
  id uuid,
  company_id uuid,
  po_number text,
  po_type text,
  batch_number text,
  status text,
  material_id uuid,
  machine_id uuid,
  stroke_master_id uuid,
  verified_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH matched_orders AS (
    SELECT
      process_order.id,
      process_order.company_id,
      process_order.po_number,
      process_order.po_type,
      process_order.batch_number,
      process_order.status,
      process_order.material_id,
      process_order.machine_id,
      process_order.stroke_master_id,
      process_order.verified_at
    FROM erp_production.process_order AS process_order
    WHERE
      (p_company_ids IS NULL OR process_order.company_id = ANY(p_company_ids))
      AND (p_process_order_ids IS NULL OR process_order.id = ANY(p_process_order_ids))
      AND (p_po_number IS NULL OR process_order.po_number = p_po_number)
      AND (
        p_process_order_ids IS NOT NULL
        OR p_po_number IS NOT NULL
        OR (
          (COALESCE(cardinality(p_po_types), 0) = 0 OR process_order.po_type = ANY(p_po_types))
          AND (p_batch_number IS NULL OR process_order.batch_number = p_batch_number)
          AND p_date_from IS NOT NULL
          AND p_date_to IS NOT NULL
          AND process_order.verified_at >= (p_date_from::timestamp AT TIME ZONE 'UTC')
          AND process_order.verified_at < ((p_date_to + 1)::timestamp AT TIME ZONE 'UTC')
        )
      )
      AND (
        NULLIF(p_search, '') IS NULL
        OR process_order.po_number ILIKE '%' || p_search || '%'
        OR process_order.po_type ILIKE '%' || p_search || '%'
        OR COALESCE(process_order.batch_number, '') ILIKE '%' || p_search || '%'
        OR process_order.status ILIKE '%' || p_search || '%'
        OR to_char(process_order.verified_at AT TIME ZONE 'UTC', 'FMDD Mon YYYY') ILIKE '%' || p_search || '%'
        OR EXISTS (
          SELECT 1
          FROM erp_master.material_master AS prodshade
          WHERE prodshade.id = process_order.material_id
            AND (
              COALESCE(prodshade.external_code, '') ILIKE '%' || p_search || '%'
              OR COALESCE(prodshade.document_name, '') ILIKE '%' || p_search || '%'
              OR prodshade.material_name ILIKE '%' || p_search || '%'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM erp_production.packing_order AS packing_order
          LEFT JOIN erp_master.material_master AS sku
            ON sku.id = packing_order.material_id
          WHERE packing_order.process_order_id = process_order.id
            AND (
              packing_order.po_number ILIKE '%' || p_search || '%'
              OR COALESCE(sku.external_code, '') ILIKE '%' || p_search || '%'
              OR COALESCE(sku.document_name, '') ILIKE '%' || p_search || '%'
              OR COALESCE(sku.material_name, '') ILIKE '%' || p_search || '%'
            )
        )
      )
  )
  SELECT
    matched_orders.id,
    matched_orders.company_id,
    matched_orders.po_number,
    matched_orders.po_type,
    matched_orders.batch_number,
    matched_orders.status,
    matched_orders.material_id,
    matched_orders.machine_id,
    matched_orders.stroke_master_id,
    matched_orders.verified_at,
    count(*) OVER () AS total_count
  FROM matched_orders
  ORDER BY matched_orders.verified_at DESC NULLS LAST, matched_orders.id DESC
  OFFSET (GREATEST(COALESCE(p_page, 1), 1) - 1) * LEAST(GREATEST(COALESCE(p_per_page, 100), 1), 200)
  LIMIT LEAST(GREATEST(COALESCE(p_per_page, 100), 1), 200);
$function$;

COMMENT ON FUNCTION public.search_batch_variance_process_orders(
  uuid[], text[], text, date, date, uuid[], text, text, integer, integer
) IS
  'Backend-only PR14 Batch Variance Report search. Applies all selection and global-search criteria before returning one page.';

REVOKE EXECUTE ON FUNCTION public.search_batch_variance_process_orders(
  uuid[], text[], text, date, date, uuid[], text, text, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_batch_variance_process_orders(
  uuid[], text[], text, date, date, uuid[], text, text, integer, integer
) TO service_role;

COMMIT;
