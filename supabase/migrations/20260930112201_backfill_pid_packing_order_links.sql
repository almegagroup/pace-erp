-- Backfill legacy Physical Inventory FG lines whose stock was seeded through
-- Opening Stock or a later status change, before stock_document started carrying
-- the PACK_PO reference. Only update a line when its batch-owning MTO/HPS/MTEST
-- Process PO has exactly one FINAL Packing PO for that exact FG material.
--
-- Deliberately limited to the production companies requested for this repair.
-- A batch with more than one matching Packing PO remains NULL: selecting one
-- without an auditable ledger reference would misstate the counted stock genealogy.
WITH matching_packing_orders AS (
  SELECT
    pi.id AS physical_inventory_item_id,
    po.id AS packing_order_id,
    COUNT(*) OVER (PARTITION BY pi.id) AS matching_packing_order_count
  FROM erp_procurement.physical_inventory_item pi
  JOIN erp_procurement.physical_inventory_document pid
    ON pid.id = pi.document_id
  JOIN erp_master.companies company
    ON company.id = pid.company_id
  JOIN erp_master.material_master material
    ON material.id = pi.material_id
  JOIN erp_production.process_order process_order
    ON process_order.company_id = pid.company_id
   AND process_order.batch_number = pi.batch_number
   AND process_order.po_type IN ('MTO', 'HPS', 'MTEST')
  JOIN erp_production.packing_order po
    ON po.process_order_id = process_order.id
   AND po.material_id = pi.material_id
   AND po.status = 'FINAL'
  WHERE company.company_code IN ('CMP003', 'CMP006')
    AND material.material_type = 'FG'
    AND pi.batch_number IS NOT NULL
    AND pi.packing_order_id IS NULL
)
UPDATE erp_procurement.physical_inventory_item pi
SET packing_order_id = match.packing_order_id
FROM matching_packing_orders match
WHERE pi.id = match.physical_inventory_item_id
  AND match.matching_packing_order_count = 1
  AND pi.packing_order_id IS NULL;
