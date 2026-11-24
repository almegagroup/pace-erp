-- SO06 "FG Movement Report": read-only aggregates over the FG stock ledger.
--
-- Only POSTED stock movements are counted (the stock ledger is the single source). Reversals count as what they are -- a
-- negative posting in the period they were made; an invoice that never moved stock (Draft / invoice-only DD) or a
-- cancelled document with no posting does not appear at all.
--
-- Columns (all in base UoM, signed from the ledger's posted_quantity):
--   opening     UNRESTRICTED balance before p_from
--   production  P101 / P102 posted by Process PO, Packing PO and PR19 partial reversal (FG receipt, net of reversals)
--   pid         every posting made by a Physical Inventory Document
--   dispatch    P601 less P602 (positive number = net dispatched)
--   other       every other UNRESTRICTED movement in the period (opening stock, status changes, returns released, GRN...)
--   closing     opening + production + pid + other - dispatch  (= UNRESTRICTED balance at p_to)
--   in_qa       QUALITY_INSPECTION balance at p_to
--   blocked     BLOCKED balance at p_to

CREATE OR REPLACE FUNCTION erp_inventory.fg_movement_summary(p_company_ids uuid[], p_from date, p_to date)
 RETURNS TABLE(company_id uuid, material_id uuid, opening numeric, production numeric, pid numeric, other numeric,
               dispatch numeric, closing numeric, in_qa numeric, blocked numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'erp_inventory', 'erp_master', 'public'
AS $function$
  WITH led AS (
    SELECT l.company_id, l.material_id, l.stock_type_code, l.posting_date, l.movement_type_code,
           l.posted_quantity AS q, COALESCE(sd.reference_document_type, '') AS ref
    FROM erp_inventory.stock_ledger l
    JOIN erp_master.material_master m ON m.id = l.material_id AND m.material_type = 'FG'
    LEFT JOIN erp_inventory.stock_document sd ON sd.id = l.stock_document_id
    WHERE l.company_id = ANY (p_company_ids) AND l.posting_date <= p_to
  ),
  agg AS (
    SELECT company_id, material_id,
      SUM(q) FILTER (WHERE stock_type_code = 'UNRESTRICTED' AND posting_date < p_from) AS opening,
      SUM(q) FILTER (WHERE stock_type_code = 'UNRESTRICTED' AND posting_date >= p_from
                      AND movement_type_code IN ('P101', 'P102') AND ref IN ('PROC_PO', 'PACK_PO', 'PARTIAL_REV')) AS production,
      SUM(q) FILTER (WHERE stock_type_code = 'UNRESTRICTED' AND posting_date >= p_from AND ref = 'PI') AS pid,
      -SUM(q) FILTER (WHERE stock_type_code = 'UNRESTRICTED' AND posting_date >= p_from
                       AND movement_type_code IN ('P601', 'P602')) AS dispatch,
      SUM(q) FILTER (WHERE stock_type_code = 'UNRESTRICTED' AND posting_date >= p_from
                      AND ref <> 'PI' AND movement_type_code NOT IN ('P601', 'P602')
                      AND NOT (movement_type_code IN ('P101', 'P102') AND ref IN ('PROC_PO', 'PACK_PO', 'PARTIAL_REV'))) AS other,
      SUM(q) FILTER (WHERE stock_type_code = 'UNRESTRICTED') AS closing,
      SUM(q) FILTER (WHERE stock_type_code = 'QUALITY_INSPECTION') AS in_qa,
      SUM(q) FILTER (WHERE stock_type_code = 'BLOCKED') AS blocked
    FROM led GROUP BY company_id, material_id
  )
  SELECT a.company_id, a.material_id,
         COALESCE(a.opening, 0), COALESCE(a.production, 0), COALESCE(a.pid, 0), COALESCE(a.other, 0),
         COALESCE(a.dispatch, 0), COALESCE(a.closing, 0), COALESCE(a.in_qa, 0), COALESCE(a.blocked, 0)
  FROM agg a
  WHERE COALESCE(a.opening, 0) <> 0 OR COALESCE(a.production, 0) <> 0 OR COALESCE(a.pid, 0) <> 0 OR COALESCE(a.other, 0) <> 0
     OR COALESCE(a.dispatch, 0) <> 0 OR COALESCE(a.closing, 0) <> 0 OR COALESCE(a.in_qa, 0) <> 0 OR COALESCE(a.blocked, 0) <> 0;
$function$;

-- Posted FG dispatch postings in the period, one row per ledger row, tied back to the sales invoice that caused it
-- (qty is positive for a dispatch and negative for its reversal), for the dispatch-type breakup and the state/town page.
CREATE OR REPLACE FUNCTION erp_inventory.fg_dispatch_postings(p_company_ids uuid[], p_from date, p_to date)
 RETURNS TABLE(company_id uuid, material_id uuid, invoice_id uuid, posting_date date, qty numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'erp_inventory', 'erp_master', 'public'
AS $function$
  SELECT l.company_id, l.material_id, sd.reference_document_id, l.posting_date, -l.posted_quantity
  FROM erp_inventory.stock_ledger l
  JOIN erp_master.material_master m ON m.id = l.material_id AND m.material_type = 'FG'
  JOIN erp_inventory.stock_document sd ON sd.id = l.stock_document_id
  WHERE l.company_id = ANY (p_company_ids)
    AND l.posting_date >= p_from AND l.posting_date <= p_to
    AND l.stock_type_code = 'UNRESTRICTED'
    AND l.movement_type_code IN ('P601', 'P602');
$function$;

REVOKE ALL ON FUNCTION erp_inventory.fg_movement_summary(uuid[], date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_inventory.fg_dispatch_postings(uuid[], date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_inventory.fg_movement_summary(uuid[], date, date) TO service_role;
GRANT EXECUTE ON FUNCTION erp_inventory.fg_dispatch_postings(uuid[], date, date) TO service_role;
