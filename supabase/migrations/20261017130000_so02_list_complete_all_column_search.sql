-- SO02 / SO03 delivery-order register: make the shared, server-paged search
-- cover every value a user can identify from the SO02 queue.  The earlier
-- predicate covered the core DO/SO/invoice fields, but omitted FO mappings,
-- SKU/material and batch values, and the pre-invoice Tally/IBN values stored
-- on a Bulk-DO header.  Keep this in the paging RPC: a client-side filter
-- would search only the current 100-row page and make real matches appear
-- missing.

CREATE OR REPLACE FUNCTION erp_procurement.list_delivery_order_page(
  p_company_id uuid,
  p_status text,
  p_search text,
  p_limit integer,
  p_offset integer,
  p_created_first boolean,
  p_date_field text,
  p_date_from date,
  p_date_to date
)
RETURNS TABLE (delivery_order_id uuid, total_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH filters AS (
    SELECT
      NULLIF(BTRIM(p_search), '') AS search_term,
      NULLIF(UPPER(BTRIM(p_date_field)), '') AS date_field,
      p_date_from AS date_from,
      p_date_to AS date_to
  ), filtered AS (
    SELECT dc.id, dc.status, dc.dc_date, dc.created_at
    FROM erp_procurement.delivery_challan AS dc
    LEFT JOIN LATERAL (
      SELECT invoice.invoice_date, invoice.tally_invoice_date
      FROM erp_procurement.sales_invoice AS invoice
      WHERE invoice.dc_id = dc.id
      ORDER BY invoice.created_at DESC NULLS LAST, invoice.id DESC
      LIMIT 1
    ) AS latest_invoice ON TRUE
    CROSS JOIN filters AS f
    WHERE dc.dc_type = ANY (ARRAY['SALES', 'STO', 'MIXED'])
      AND (p_company_id IS NULL OR dc.selling_company_id = p_company_id)
      AND (NULLIF(BTRIM(p_status), '') IS NULL OR dc.status = UPPER(BTRIM(p_status)))
      AND (
        f.date_from IS NULL
        OR f.date_to IS NULL
        OR CASE f.date_field
          WHEN 'DC_DATE' THEN dc.dc_date
          WHEN 'LR_DATE' THEN dc.lr_date
          WHEN 'INVOICE_DATE' THEN latest_invoice.invoice_date
          -- Before PGI the Tally date lives on the DO (Bulk DO Upload); the
          -- register shows that same value, so the date filter must as well.
          WHEN 'TALLY_INVOICE_DATE' THEN COALESCE(latest_invoice.tally_invoice_date, dc.pre_invoice_tally_invoice_date)
          WHEN 'DISPATCH_DATE' THEN dc.dispatch_date
        END BETWEEN f.date_from AND f.date_to
      )
      AND (
        f.search_term IS NULL
        -- Header and every direct SO02 register field held on the DO.
        OR CONCAT_WS(' ',
          dc.dc_number,
          dc.dc_type,
          dc.dc_date,
          dc.lr_number,
          dc.lr_date,
          dc.vehicle_number,
          dc.dispatch_date,
          dc.status,
          dc.total_value,
          dc.transporter_name_freetext,
          dc.pre_invoice_tally_invoice_number,
          dc.pre_invoice_tally_invoice_date,
          dc.pre_invoice_inbound_number
        ) ILIKE '%' || f.search_term || '%'
        OR 'SALES ORDER' ILIKE '%' || f.search_term || '%'
           AND (dc.sales_order_id IS NOT NULL OR EXISTS (
             SELECT 1
             FROM erp_procurement.delivery_challan_source AS dcs
             WHERE dcs.dc_id = dc.id AND dcs.source_type = 'SALES_ORDER'
           ))
        OR 'STO' ILIKE '%' || f.search_term || '%'
           AND (dc.sto_id IS NOT NULL OR EXISTS (
             SELECT 1
             FROM erp_procurement.delivery_challan_source AS dcs
             WHERE dcs.dc_id = dc.id AND dcs.source_type = 'STO'
           ))
        -- Customer / transporter displays shown in the queue.
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
        -- SO number/external SO, Bill-To and dispatch category.
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
          AND CONCAT_WS(' ', so.so_number, so.customer_po_number, so.bill_to_name, so.bill_to_address, so.dispatch_category)
              ILIKE '%' || f.search_term || '%'
        )
        -- STO number and the receiving-company name/address display.
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
          AND CONCAT_WS(' ', sto.sto_number, receiving_company.company_name, receiving_company.full_address)
              ILIKE '%' || f.search_term || '%'
        )
        -- Line, SKU/material, UoM, Batch, Ship-To and FG-type columns.  FO
        -- number is resolved through the line's SO-map allocation so both the
        -- original and revised FO remain findable from SO02.
        OR EXISTS (
          SELECT 1
          FROM erp_procurement.delivery_challan_line AS line
          LEFT JOIN erp_master.material_master AS material ON material.id = line.material_id
          LEFT JOIN erp_procurement.sales_order_line AS so_line ON so_line.id = line.so_line_id
          LEFT JOIN erp_procurement.sales_order_map_allocation AS allocation ON allocation.id = line.so_map_allocation_id
          LEFT JOIN erp_procurement.sales_order_map_group AS map_group ON map_group.id = allocation.map_group_id
          WHERE line.dc_id = dc.id
            AND CONCAT_WS(' ',
              line.ship_to_name,
              line.ship_to_address,
              line.ship_to_state,
              line.batch_number,
              line.uom_code,
              line.pack_uom_code,
              line.quantity,
              line.pack_qty,
              line.line_total,
              material.pace_code,
              material.external_code,
              material.material_name,
              material.material_type,
              so_line.fg_type,
              map_group.external_fo_number,
              map_group.revised_external_fo_number
            ) ILIKE '%' || f.search_term || '%'
        )
        -- Totals are derived from the individual DO lines, not necessarily
        -- copied to a header total, so preserve aggregate searching too.
        OR EXISTS (
          SELECT 1
          FROM erp_procurement.delivery_challan_line AS line
          WHERE line.dc_id = dc.id
          GROUP BY line.dc_id
          HAVING CONCAT_WS(' ',
            COALESCE(SUM(line.quantity), 0),
            COALESCE(SUM(line.pack_qty), 0),
            COALESCE(SUM(line.line_total), 0)
          ) ILIKE '%' || f.search_term || '%'
        )
        -- Posted / draft invoice fields, with the Bulk-DO header fallback
        -- above for pre-invoice records.
        OR EXISTS (
          SELECT 1
          FROM erp_procurement.sales_invoice AS invoice
          WHERE invoice.dc_id = dc.id
            AND CONCAT_WS(' ',
              invoice.invoice_number,
              invoice.invoice_date,
              invoice.tally_invoice_number,
              invoice.tally_invoice_date,
              invoice.inbound_number,
              invoice.status
            ) ILIKE '%' || f.search_term || '%'
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

GRANT EXECUTE ON FUNCTION erp_procurement.list_delivery_order_page(uuid, text, text, integer, integer, boolean, text, date, date) TO service_role;
