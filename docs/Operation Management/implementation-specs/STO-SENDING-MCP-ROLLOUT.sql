-- R-04 operational repair: run separately in each environment AFTER schema rollout.
-- No GRN, receipt, invoice, stock or STO confirmation is created here.
BEGIN;
CREATE TEMP TABLE sto_csn_candidates ON COMMIT DROP AS
SELECT c.id AS csn_id,l.id AS line_id
FROM erp_procurement.consignment_note c
JOIN erp_procurement.stock_transfer_order_line l ON l.sto_id=c.sto_id
 AND l.material_id=c.material_id AND l.uom_code=c.po_uom_code AND l.quantity=c.po_qty
WHERE c.sto_id IS NOT NULL AND c.sto_line_id IS NULL;
DO $check$
BEGIN
  IF EXISTS (SELECT csn_id FROM sto_csn_candidates GROUP BY csn_id HAVING count(*)<>1)
    OR EXISTS (SELECT line_id FROM sto_csn_candidates GROUP BY line_id HAVING count(*)<>1)
    OR EXISTS (SELECT 1 FROM erp_procurement.consignment_note c WHERE c.sto_id IS NOT NULL AND c.sto_line_id IS NULL
       AND NOT EXISTS(SELECT 1 FROM sto_csn_candidates m WHERE m.csn_id=c.id))
    THEN RAISE EXCEPTION 'STO_CSN_MAPPING_REQUIRES_REVIEW'; END IF;
END $check$;
UPDATE erp_procurement.consignment_note c SET sto_line_id=m.line_id
FROM sto_csn_candidates m WHERE c.id=m.csn_id AND c.sto_line_id IS NULL;
COMMIT;

SELECT count(*) AS remaining_unmapped FROM erp_procurement.consignment_note
WHERE sto_id IS NOT NULL AND sto_line_id IS NULL;
