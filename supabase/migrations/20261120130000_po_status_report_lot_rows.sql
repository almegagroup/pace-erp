-- PO24 PO Status: a PO line that is split into lots (purchase_order_lot) also returns one row per lot right under the line row.
-- Line rows are unchanged. A lot row shows the lot's own qty, what was received against that lot (POSTED GRNs of gate entry lines
-- carrying that lot number), its open qty and QA blocked qty; in-transit and knocked-off are not tracked per lot, so they stay NULL.
DROP FUNCTION IF EXISTS erp_procurement.po_status_report(uuid[], date, date, boolean);

CREATE FUNCTION erp_procurement.po_status_report(p_company_ids uuid[], p_from date, p_to date, p_open_only boolean)
 RETURNS TABLE(company_id uuid, company_code text, vendor_id uuid, vendor_code text, vendor_name text, po_id uuid, po_number text,
               po_date date, po_status text, line_id uuid, line_number integer, material_id uuid, pace_code text, material_name text,
               po_uom text, po_qty numeric, delivered numeric, in_transit numeric, open_qty numeric, knocked_off_qty numeric,
               blocked_qty numeric, line_status text, unit_rate numeric, currency_code text,
               row_kind text, lot_number text, lot_delivery_date date)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'erp_procurement', 'erp_master', 'public'
AS $function$
  WITH grn AS (
    SELECT g.po_line_id, SUM(g.received_qty) AS delivered,
           SUM(COALESCE((SELECT SUM(dl.decision_qty)
                           FROM erp_procurement.inward_qa_document q
                           JOIN erp_procurement.inward_qa_decision_line dl ON dl.qa_document_id = q.id
                          WHERE q.grn_id = g.id AND dl.usage_decision IN ('BLOCK', 'REJECT')), 0)
                / NULLIF(COALESCE(g.per_pack_qty, 1), 0)) AS blocked
    FROM erp_procurement.goods_receipt g
    WHERE g.status = 'POSTED' AND g.po_line_id IS NOT NULL AND g.company_id = ANY (p_company_ids)
    GROUP BY g.po_line_id
  ),
  transit AS (
    SELECT c.po_line_id, SUM(GREATEST(COALESCE(c.dispatch_qty, 0) - COALESCE(c.total_received_qty, 0), 0)) AS in_transit
    FROM erp_procurement.consignment_note c
    WHERE c.status IN ('TRN', 'GED') AND c.po_line_id IS NOT NULL AND c.company_id = ANY (p_company_ids)
    GROUP BY c.po_line_id
  ),
  lines AS (
    SELECT po.company_id, co.company_code, po.vendor_id, v.vendor_code, v.vendor_name, po.id AS po_id, po.po_number, po.po_date::date AS po_date,
           po.status AS po_status, l.id AS line_id, l.line_number, l.material_id, m.pace_code,
           COALESCE(NULLIF(m.document_name, ''), m.material_name) AS material_name, l.po_uom_code, l.ordered_qty,
           COALESCE(gr.delivered, 0) AS delivered, COALESCE(t.in_transit, 0) AS in_transit,
           CASE WHEN l.line_status IN ('OPEN', 'PARTIALLY_RECEIVED') THEN GREATEST(COALESCE(l.open_qty, 0), 0) ELSE 0 END AS open_qty,
           COALESCE(l.knocked_off_qty, 0) AS knocked_off_qty, COALESCE(gr.blocked, 0) AS blocked, l.line_status, l.unit_rate, l.currency_code
    FROM erp_procurement.purchase_order po
    JOIN erp_procurement.purchase_order_line l ON l.po_id = po.id
    JOIN erp_master.companies co ON co.id = po.company_id
    LEFT JOIN erp_master.vendor_master v ON v.id = po.vendor_id
    LEFT JOIN erp_master.material_master m ON m.id = l.material_id
    LEFT JOIN grn gr ON gr.po_line_id = l.id
    LEFT JOIN transit t ON t.po_line_id = l.id
    WHERE po.company_id = ANY (p_company_ids)
      AND po.status <> 'DRAFT'
      AND po.po_date::date >= p_from AND po.po_date::date <= p_to
      AND (NOT p_open_only OR (po.status = 'CONFIRMED' AND l.line_status IN ('OPEN', 'PARTIALLY_RECEIVED')))
  )
  SELECT * FROM (
    SELECT ln.company_id, ln.company_code, ln.vendor_id, ln.vendor_code, ln.vendor_name, ln.po_id, ln.po_number, ln.po_date, ln.po_status,
           ln.line_id, ln.line_number, ln.material_id, ln.pace_code, ln.material_name, ln.po_uom_code, ln.ordered_qty, ln.delivered,
           ln.in_transit, ln.open_qty, ln.knocked_off_qty, ln.blocked, ln.line_status, ln.unit_rate, ln.currency_code,
           'LINE'::text AS row_kind, NULL::text AS lot_number, NULL::date AS lot_delivery_date
    FROM lines ln
    UNION ALL
    SELECT ln.company_id, ln.company_code, ln.vendor_id, ln.vendor_code, ln.vendor_name, ln.po_id, ln.po_number, ln.po_date, ln.po_status,
           ln.line_id, ln.line_number, ln.material_id, ln.pace_code, ln.material_name, ln.po_uom_code, lot.lot_qty,
           COALESCE(rcv.qty, 0), NULL::numeric, GREATEST(lot.lot_qty - COALESCE(rcv.qty, 0), 0), NULL::numeric, COALESCE(rcv.blocked, 0),
           lot.status, ln.unit_rate, ln.currency_code, 'LOT'::text, lot.lot_number, lot.delivery_date
    FROM lines ln
    JOIN erp_procurement.purchase_order_lot lot ON lot.po_line_id = ln.line_id
    LEFT JOIN LATERAL (
      SELECT SUM(g.received_qty) AS qty,
             SUM(COALESCE((SELECT SUM(dl.decision_qty)
                             FROM erp_procurement.inward_qa_document q
                             JOIN erp_procurement.inward_qa_decision_line dl ON dl.qa_document_id = q.id
                            WHERE q.grn_id = g.id AND dl.usage_decision IN ('BLOCK', 'REJECT')), 0)
                  / NULLIF(COALESCE(g.per_pack_qty, 1), 0)) AS blocked
      FROM erp_procurement.goods_receipt g
      JOIN erp_procurement.gate_entry_line gl ON gl.id = COALESCE(g.gate_entry_line_id, g.source_gate_entry_line_id)
      WHERE g.status = 'POSTED' AND gl.po_line_id = ln.line_id AND gl.lot_number = lot.lot_number
    ) rcv ON true
  ) x
  ORDER BY x.company_code, x.vendor_name, x.po_number, x.line_number, x.lot_number NULLS FIRST;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.po_status_report(uuid[], date, date, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.po_status_report(uuid[], date, date, boolean) TO service_role;
