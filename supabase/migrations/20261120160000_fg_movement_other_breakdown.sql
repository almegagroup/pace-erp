-- SO06: the single "Other adj." column is split into one column per kind of movement (Opening Stock, GRN Receipt, Blocked -> Unrestricted ...).
-- Same population as fg_movement_summary.other (UNRESTRICTED stock, inside the period, not PID, not dispatch P601/P602, not Process/Packing
-- PO / PR19 production receipt), grouped by movement type; P101/P102 also carry the source document type so a GRN receipt is told apart.
CREATE OR REPLACE FUNCTION erp_inventory.fg_movement_other(p_company_ids uuid[], p_from date, p_to date)
 RETURNS TABLE(company_id uuid, material_id uuid, cat text, qty numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'erp_inventory', 'erp_master', 'public'
AS $function$
  WITH led AS (
    SELECT l.company_id, l.material_id, l.movement_type_code, l.posted_quantity AS q,
           COALESCE((SELECT sd.reference_document_type FROM erp_inventory.stock_document sd WHERE sd.id = l.stock_document_id), '') AS ref
    FROM erp_inventory.stock_ledger l
    JOIN erp_master.material_master m ON m.id = l.material_id AND m.material_type = 'FG'
    WHERE l.company_id = ANY (p_company_ids) AND l.posting_date >= p_from AND l.posting_date <= p_to
      AND l.stock_type_code = 'UNRESTRICTED' AND l.movement_type_code NOT IN ('P601', 'P602')
  )
  SELECT led.company_id, led.material_id,
         CASE WHEN led.movement_type_code IN ('P101', 'P102') THEN led.movement_type_code || '|' || led.ref ELSE led.movement_type_code END AS cat,
         SUM(led.q) AS qty
  FROM led
  WHERE led.ref <> 'PI' AND NOT (led.movement_type_code IN ('P101', 'P102') AND led.ref IN ('PROC_PO', 'PACK_PO', 'PARTIAL_REV'))
  GROUP BY 1, 2, 3
  HAVING SUM(led.q) <> 0;
$function$;

REVOKE ALL ON FUNCTION erp_inventory.fg_movement_other(uuid[], date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_inventory.fg_movement_other(uuid[], date, date) TO service_role;
