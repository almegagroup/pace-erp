-- SO01 §133.9-G — Manual FG SKU (typed, not found in Material Master/Stroke
-- Master). Additive on top of 20260828100000; that migration is shipped and
-- must not be edited.

ALTER TABLE erp_procurement.sales_order_line
  ALTER COLUMN material_id DROP NOT NULL,
  ADD COLUMN manual_sku_name text;

ALTER TABLE erp_procurement.sales_order_line
  ADD CONSTRAINT sales_order_line_material_or_manual_check
    CHECK (material_id IS NOT NULL OR manual_sku_name IS NOT NULL);

COMMENT ON COLUMN erp_procurement.sales_order_line.manual_sku_name IS
  'Feasibility §133.9-G — FG SKU typed manually because it exists in neither Material Master nor Stroke Master yet. NULL once the line is resolved to a real material_id. Drives the red "not in PACE" warning on this row and on downstream reports.';

NOTIFY pgrst, 'reload schema';
