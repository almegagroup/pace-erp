-- SO02 / SO03: search the complete Delivery Order register, not only the
-- internal DO number.  This RPC is the paging authority for both screens,
-- so keeping the predicate here makes a match discoverable on every page.

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
  WITH filters AS (
    SELECT NULLIF(BTRIM(p_search), '') AS search_term
  ), filtered AS (
    SELECT dc.id, dc.status, dc.dc_date, dc.created_at
    FROM erp_procurement.delivery_challan AS dc
    CROSS JOIN filters AS f
    WHERE dc.dc_type = ANY (ARRAY['SALES', 'STO', 'MIXED'])
      AND (p_company_id IS NULL OR dc.selling_company_id = p_company_id)
      AND (NULLIF(BTRIM(p_status), '') IS NULL OR dc.status = UPPER(BTRIM(p_status)))
      AND (
        f.search_term IS NULL
        OR dc.dc_number ILIKE '%' || f.search_term || '%'
        OR COALESCE(dc.dc_type, '') ILIKE '%' || f.search_term || '%'
        OR 'SALES ORDER' ILIKE '%' || f.search_term || '%'
           AND (dc.sales_order_id IS NOT NULL OR EXISTS (
             SELECT 1 FROM erp_procurement.delivery_challan_source AS dcs
             WHERE dcs.dc_id = dc.id AND dcs.source_type = 'SALES_ORDER'
           ))
        OR 'STO' ILIKE '%' || f.search_term || '%'
           AND (dc.sto_id IS NOT NULL OR EXISTS (
             SELECT 1 FROM erp_procurement.delivery_challan_source AS dcs
             WHERE dcs.dc_id = dc.id AND dcs.source_type = 'STO'
           ))
        OR COALESCE(dc.dc_date::text, '') ILIKE '%' || f.search_term || '%'
        OR COALESCE(dc.vehicle_number, '') ILIKE '%' || f.search_term || '%'
        OR COALESCE(dc.lr_number, '') ILIKE '%' || f.search_term || '%'
        OR COALESCE(dc.status, '') ILIKE '%' || f.search_term || '%'
        OR COALESCE(dc.total_value::text, '') ILIKE '%' || f.search_term || '%'
        OR COALESCE(dc.transporter_name_freetext, '') ILIKE '%' || f.search_term || '%'
        OR EXISTS (
          SELECT 1
          FROM erp_master.customer_master AS customer
          WHERE customer.id = dc.customer_id
            AND CONCAT_WS(' ', customer.customer_code, customer.customer_name) ILIKE '%' || f.search_term || '%'
        )
        OR EXISTS (
          SELECT 1
          FROM erp_master.transporter_master AS transporter
          WHERE transporter.id = dc.transporter_id
            AND CONCAT_WS(' ', transporter.transporter_code, transporter.transporter_name) ILIKE '%' || f.search_term || '%'
        )
        OR EXISTS (
          SELECT 1
          FROM erp_procurement.sales_order AS so
          WHERE (
            so.id = dc.sales_order_id
            OR EXISTS (
              SELECT 1 FROM erp_procurement.delivery_challan_source AS dcs
              WHERE dcs.dc_id = dc.id
                AND dcs.source_type = 'SALES_ORDER'
                AND dcs.source_id = so.id
            )
          )
          AND CONCAT_WS(' ', so.so_number, so.customer_po_number, so.bill_to_name, so.bill_to_address, so.dispatch_category) ILIKE '%' || f.search_term || '%'
        )
        OR EXISTS (
          SELECT 1
          FROM erp_procurement.stock_transfer_order AS sto
          LEFT JOIN erp_master.companies AS receiving_company ON receiving_company.id = sto.receiving_company_id
          WHERE (
            sto.id = dc.sto_id
            OR EXISTS (
              SELECT 1 FROM erp_procurement.delivery_challan_source AS dcs
              WHERE dcs.dc_id = dc.id
                AND dcs.source_type = 'STO'
                AND dcs.source_id = sto.id
            )
          )
          AND CONCAT_WS(' ', sto.sto_number, receiving_company.company_name, receiving_company.full_address) ILIKE '%' || f.search_term || '%'
        )
        OR EXISTS (
          SELECT 1
          FROM erp_procurement.delivery_challan_line AS line
          LEFT JOIN erp_master.material_master AS material ON material.id = line.material_id
          LEFT JOIN erp_procurement.sales_order_line AS so_line ON so_line.id = line.so_line_id
          WHERE line.dc_id = dc.id
            AND CONCAT_WS(' ', line.ship_to_name, line.ship_to_address, line.ship_to_state, material.material_type, so_line.fg_type) ILIKE '%' || f.search_term || '%'
        )
        OR EXISTS (
          SELECT 1
          FROM erp_procurement.delivery_challan_line AS line
          WHERE line.dc_id = dc.id
          GROUP BY line.dc_id
          HAVING COALESCE(SUM(line.quantity), 0)::text ILIKE '%' || f.search_term || '%'
              OR COALESCE(SUM(line.pack_qty), 0)::text ILIKE '%' || f.search_term || '%'
              OR COALESCE(SUM(line.line_total), 0)::text ILIKE '%' || f.search_term || '%'
        )
        OR EXISTS (
          SELECT 1
          FROM erp_procurement.sales_invoice AS invoice
          WHERE invoice.dc_id = dc.id
            AND CONCAT_WS(' ', invoice.invoice_number, invoice.invoice_date, invoice.tally_invoice_number, invoice.tally_invoice_date, invoice.inbound_number, invoice.status) ILIKE '%' || f.search_term || '%'
        )
      )
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
