-- PO24 "PO Status" (Procurement menu) and PO23 "GRN Receiving Report" (Receiving menu): read-only aggregates.
--
-- Quantities are in the PO's own UoM. Only live documents count: GRN status POSTED (a SPLIT original is represented by its
-- POSTED children, REVERSED / cancelled never count), gate entries that are not PRUNED / CANCELLED.
--   Delivered   = sum of POSTED GRN received_qty for the PO line
--   In-transit  = CSN dispatched (TRN) or at the gate (GED) for the line, dispatch_qty - already received, never below 0
--   Open        = the line's open_qty (PO qty - delivered - knocked off); 0 once the line is knocked off / cancelled
--   QA Blocked  = Inward QA BLOCK + REJECT decisions on the line's POSTED GRNs, converted from base UoM to PO UoM (/ per_pack_qty)

CREATE OR REPLACE FUNCTION erp_procurement.po_status_report(p_company_ids uuid[], p_from date, p_to date, p_open_only boolean)
 RETURNS TABLE(company_id uuid, company_code text, vendor_id uuid, vendor_code text, vendor_name text, po_id uuid, po_number text,
               po_date date, po_status text, line_id uuid, line_number integer, material_id uuid, pace_code text, material_name text,
               po_uom text, po_qty numeric, delivered numeric, in_transit numeric, open_qty numeric, knocked_off_qty numeric,
               blocked_qty numeric, line_status text, unit_rate numeric, currency_code text)
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
  )
  SELECT po.company_id, co.company_code, po.vendor_id, v.vendor_code, v.vendor_name, po.id, po.po_number, po.po_date::date, po.status,
         l.id, l.line_number, l.material_id, m.pace_code, COALESCE(NULLIF(m.document_name, ''), m.material_name),
         l.po_uom_code, l.ordered_qty, COALESCE(gr.delivered, 0), COALESCE(t.in_transit, 0),
         CASE WHEN l.line_status IN ('OPEN', 'PARTIALLY_RECEIVED') THEN GREATEST(COALESCE(l.open_qty, 0), 0) ELSE 0 END,
         COALESCE(l.knocked_off_qty, 0), COALESCE(gr.blocked, 0), l.line_status, l.unit_rate, l.currency_code
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
  ORDER BY co.company_code, v.vendor_name, po.po_number, l.line_number;
$function$;

-- One row per GRN of a gate entry line (a gate entry line that has no GRN yet shows once with blank GRN columns).
CREATE OR REPLACE FUNCTION erp_procurement.grn_receiving_report(p_company_ids uuid[], p_from date, p_to date)
 RETURNS TABLE(company_id uuid, company_code text, ge_id uuid, ge_number text, ge_date date, ge_line_number integer, ge_qty numeric,
               vendor_code text, vendor_name text, po_id uuid, po_number text, line_number integer, material_id uuid, pace_code text,
               material_name text, po_uom text, po_qty numeric, po_rate numeric, currency_code text, grn_count integer,
               grn_id uuid, grn_number text, grn_date date, grn_qty numeric, blocked_qty numeric, balance_after numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'erp_procurement', 'erp_master', 'public'
AS $function$
  WITH ge_lines AS (
    SELECT ge.id AS ge_id, ge.ge_number, ge.ge_date::date AS ge_date, ge.company_id, l.id AS ge_line_id, l.line_number AS ge_line_number,
           l.ge_qty, l.po_id, l.po_line_id
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
           SUM(g.received_qty) OVER (PARTITION BY g.po_line_id ORDER BY g.grn_date, g.created_at, g.id) AS cum_received
    FROM erp_procurement.goods_receipt g
    WHERE g.status = 'POSTED' AND g.po_line_id IN (SELECT po_line_id FROM ge_lines)
  )
  SELECT gl.company_id, co.company_code, gl.ge_id, gl.ge_number, gl.ge_date, gl.ge_line_number, gl.ge_qty,
         v.vendor_code, v.vendor_name, po.id, po.po_number, pol.line_number, pol.material_id, m.pace_code,
         COALESCE(NULLIF(m.document_name, ''), m.material_name), pol.po_uom_code, pol.ordered_qty,
         COALESCE(gr.po_rate, pol.unit_rate), pol.currency_code,
         (COUNT(gr.id) OVER (PARTITION BY gl.ge_line_id))::integer,
         gr.id, gr.grn_number, gr.grn_date, gr.received_qty, gr.blocked,
         CASE WHEN gr.id IS NULL THEN NULL ELSE pol.ordered_qty - gr.cum_received END
  FROM ge_lines gl
  JOIN erp_master.companies co ON co.id = gl.company_id
  JOIN erp_procurement.purchase_order_line pol ON pol.id = gl.po_line_id
  JOIN erp_procurement.purchase_order po ON po.id = pol.po_id
  LEFT JOIN erp_master.vendor_master v ON v.id = po.vendor_id
  LEFT JOIN erp_master.material_master m ON m.id = pol.material_id
  LEFT JOIN grn gr ON gr.ge_line_id = gl.ge_line_id
  ORDER BY co.company_code, gl.ge_date, gl.ge_number, gl.ge_line_number, gr.grn_date, gr.grn_number;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.po_status_report(uuid[], date, date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_procurement.grn_receiving_report(uuid[], date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.po_status_report(uuid[], date, date, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION erp_procurement.grn_receiving_report(uuid[], date, date) TO service_role;
