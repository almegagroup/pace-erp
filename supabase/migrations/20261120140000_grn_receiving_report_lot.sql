-- PO23 GRN Receiving Report: lot number of the gate entry line, the lot's qty and the lot balance after each GRN.
-- One row per GRN of a gate entry line (a gate entry line that has no GRN yet shows once with blank GRN columns).
DROP FUNCTION IF EXISTS erp_procurement.grn_receiving_report(uuid[], date, date);
CREATE FUNCTION erp_procurement.grn_receiving_report(p_company_ids uuid[], p_from date, p_to date)
 RETURNS TABLE(company_id uuid, company_code text, ge_id uuid, ge_number text, ge_date date, ge_line_number integer, ge_qty numeric,
               vendor_code text, vendor_name text, po_id uuid, po_number text, line_number integer, material_id uuid, pace_code text,
               material_name text, po_uom text, po_qty numeric, po_rate numeric, currency_code text, grn_count integer,
               grn_id uuid, grn_number text, grn_date date, grn_qty numeric, blocked_qty numeric, balance_after numeric,
               lot_number text, lot_qty numeric, lot_balance_after numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'erp_procurement', 'erp_master', 'public'
AS $function$
  WITH ge_lines AS (
    SELECT ge.id AS ge_id, ge.ge_number, ge.ge_date::date AS ge_date, ge.company_id, l.id AS ge_line_id, l.line_number AS ge_line_number,
           l.ge_qty, l.po_id, l.po_line_id, l.lot_number
    FROM erp_procurement.gate_entry ge
    JOIN erp_procurement.gate_entry_line l ON l.gate_entry_id = ge.id
    WHERE ge.company_id = ANY (p_company_ids) AND ge.status NOT IN ('PRUNED', 'CANCELLED')
      AND l.po_line_id IS NOT NULL
      AND ge.ge_date::date >= p_from AND ge.ge_date::date <= p_to
  ),
  grn AS (
    -- every live GRN of the PO lines involved, so the running balance is right whatever the date filter is
    SELECT g.id, g.grn_number, g.grn_date::date AS grn_date, g.po_line_id, g.received_qty,
           COALESCE(g.gate_entry_line_id, g.source_gate_entry_line_id) AS ge_line_id,
           COALESCE((SELECT SUM(dl.decision_qty)
                       FROM erp_procurement.inward_qa_document q
                       JOIN erp_procurement.inward_qa_decision_line dl ON dl.qa_document_id = q.id
                      WHERE q.grn_id = g.id AND dl.usage_decision IN ('BLOCK', 'REJECT')), 0)
             / NULLIF(COALESCE(g.per_pack_qty, 1), 0) AS blocked,
           g.po_rate,
           SUM(g.received_qty) OVER (PARTITION BY g.po_line_id ORDER BY g.grn_date, g.created_at, g.id) AS cum_received,
           gl2.lot_number AS grn_lot,
           SUM(g.received_qty) OVER (PARTITION BY g.po_line_id, gl2.lot_number ORDER BY g.grn_date, g.created_at, g.id) AS cum_lot_received
    FROM erp_procurement.goods_receipt g
    LEFT JOIN erp_procurement.gate_entry_line gl2 ON gl2.id = COALESCE(g.gate_entry_line_id, g.source_gate_entry_line_id)
    WHERE g.status = 'POSTED' AND g.po_line_id IN (SELECT po_line_id FROM ge_lines)
  )
  SELECT gl.company_id, co.company_code, gl.ge_id, gl.ge_number, gl.ge_date, gl.ge_line_number, gl.ge_qty,
         v.vendor_code, v.vendor_name, po.id, po.po_number, pol.line_number, pol.material_id, m.pace_code,
         COALESCE(NULLIF(m.document_name, ''), m.material_name), pol.po_uom_code, pol.ordered_qty,
         COALESCE(gr.po_rate, pol.unit_rate), pol.currency_code,
         (COUNT(gr.id) OVER (PARTITION BY gl.ge_line_id))::integer,
         gr.id, gr.grn_number, gr.grn_date, gr.received_qty, gr.blocked,
         CASE WHEN gr.id IS NULL THEN NULL ELSE pol.ordered_qty - gr.cum_received END,
         gl.lot_number, lot.lot_qty,
         CASE WHEN gr.id IS NULL OR lot.id IS NULL THEN NULL ELSE lot.lot_qty - gr.cum_lot_received END
  FROM ge_lines gl
  JOIN erp_master.companies co ON co.id = gl.company_id
  JOIN erp_procurement.purchase_order_line pol ON pol.id = gl.po_line_id
  JOIN erp_procurement.purchase_order po ON po.id = pol.po_id
  LEFT JOIN erp_master.vendor_master v ON v.id = po.vendor_id
  LEFT JOIN erp_master.material_master m ON m.id = pol.material_id
  LEFT JOIN grn gr ON gr.ge_line_id = gl.ge_line_id
  LEFT JOIN LATERAL (
    SELECT l2.id, l2.lot_qty FROM erp_procurement.purchase_order_lot l2
    WHERE l2.po_line_id = gl.po_line_id AND l2.lot_number = gl.lot_number
    ORDER BY COALESCE(l2.amendment_number, 0) DESC LIMIT 1
  ) lot ON true
  ORDER BY co.company_code, gl.ge_date, gl.ge_number, gl.ge_line_number, gr.grn_date, gr.grn_number;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.grn_receiving_report(uuid[], date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.grn_receiving_report(uuid[], date, date) TO service_role;
