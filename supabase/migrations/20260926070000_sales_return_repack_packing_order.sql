-- business owner, 2026-09-26: found live (CMP003) -- when a Sales Return
-- item is repacked (e.g. pack code 000 -> 599), the physical stock that
-- lands in Blocked is the REPACK TARGET's own SKU+batch combination, which
-- was never itself packed by any real Packing PO (only the item's own
-- pre-repack SKU+batch has one, from whenever it was originally dispatched).
-- sales_return_item.packing_order_id can only ever resolve against the
-- item's OWN material_id, so it structurally cannot represent "this
-- repacked SKU's own Packing PO" -- and without one, PR19 (Partial
-- Reversal) can never act on that blocked stock later, since PR19's SKU-row
-- reversal hard-requires a real packing_order_id for the exact material it
-- reverses. Gives each repack line its own packing_order_id, resolved and
-- backfilled independently of the parent item's.

ALTER TABLE erp_procurement.sales_return_repack_line
  ADD COLUMN packing_order_id uuid NULL REFERENCES erp_production.packing_order(id);

CREATE INDEX ix_sales_return_repack_line_pending_packing
  ON erp_procurement.sales_return_repack_line(target_material_id)
  WHERE packing_order_id IS NULL;

-- Same audited cross-schema/company predicate as the item version
-- (backfill_sales_return_packing_order, in 20260925182040_sales_return.sql)
-- extended to also backfill any repack line whose target_material_id +
-- parent item's own batch_number matches the newly-created/matching
-- packing_order. A repack line has no batch_number column of its own --
-- repacking never changes which batch it is, only the pack shape -- so the
-- match always reads the parent sales_return_item's batch_number.
CREATE OR REPLACE FUNCTION erp_procurement.backfill_sales_return_packing_order(
  p_packing_order_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public AS $$
DECLARE
  v_updated integer := 0;
  v_repack_updated integer := 0;
BEGIN
  UPDATE erp_procurement.sales_return_item i
  SET packing_order_id = po.id
  FROM erp_procurement.sales_return_invoice inv
  JOIN erp_procurement.sales_return_receipt r ON r.id = inv.receipt_id
  JOIN erp_production.packing_order po ON po.id = p_packing_order_id
  WHERE i.invoice_id = inv.id
    AND i.packing_order_id IS NULL
    AND i.line_material_type = 'FG'
    AND i.fg_type IN ('MTO','HPS','MTEST')
    AND i.material_id = po.material_id
    AND i.batch_number = po.batch_number
    AND r.company_id = po.company_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  UPDATE erp_procurement.sales_return_repack_line rl
  SET packing_order_id = po.id
  FROM erp_procurement.sales_return_item i
  JOIN erp_procurement.sales_return_invoice inv ON inv.id = i.invoice_id
  JOIN erp_procurement.sales_return_receipt r ON r.id = inv.receipt_id
  JOIN erp_production.packing_order po ON po.id = p_packing_order_id
  WHERE rl.item_id = i.id
    AND rl.packing_order_id IS NULL
    AND i.line_material_type = 'FG'
    AND i.fg_type IN ('MTO','HPS','MTEST')
    AND rl.target_material_id = po.material_id
    AND i.batch_number = po.batch_number
    AND r.company_id = po.company_id;

  GET DIAGNOSTICS v_repack_updated = ROW_COUNT;

  RETURN v_updated + v_repack_updated;
END;
$$;
REVOKE ALL ON FUNCTION erp_procurement.backfill_sales_return_packing_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.backfill_sales_return_packing_order(uuid) TO service_role;
