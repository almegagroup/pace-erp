-- SO06 FG Movement Report timed out (the API role cuts a statement at 8 s; the function took ~9 s on CMP005 prod).
-- 1) a covering index so the per-company ledger scan is an index-only scan, no heap fetch per row;
-- 2) the stock_document reference type is only needed for rows inside the report period, so it is looked up only for those
--    (before, every ledger row since go-live paid a stock_document lookup). Same columns, same numbers as before.
CREATE INDEX IF NOT EXISTS idx_sl_company_posting_cover ON erp_inventory.stock_ledger (company_id, posting_date)
  INCLUDE (material_id, stock_type_code, movement_type_code, posted_quantity, stock_document_id);

CREATE OR REPLACE FUNCTION erp_inventory.fg_movement_summary(p_company_ids uuid[], p_from date, p_to date)
 RETURNS TABLE(company_id uuid, material_id uuid, opening numeric, production numeric, pid numeric, other numeric, dispatch numeric, closing numeric, in_qa numeric, blocked numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'erp_inventory', 'erp_master', 'public'
AS $function$
  WITH led AS (
    SELECT l.company_id, l.material_id, l.stock_type_code, l.posting_date, l.movement_type_code,
           l.posted_quantity AS q,
           CASE WHEN l.posting_date >= p_from
                THEN COALESCE((SELECT sd.reference_document_type FROM erp_inventory.stock_document sd WHERE sd.id = l.stock_document_id), '')
                ELSE '' END AS ref
    FROM erp_inventory.stock_ledger l
    JOIN erp_master.material_master m ON m.id = l.material_id AND m.material_type = 'FG'
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
