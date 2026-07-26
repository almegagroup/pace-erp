/*
 * Gate 27 Packing PO direct-create redesign
 * Purpose: Packing PO is created directly from company/type/SKU, without QA/Verify
 *          and without requiring a Process PO at create time. Process PO linkage
 *          remains optional for a later consume/link step.
 */

ALTER TABLE erp_production.packing_order
  ALTER COLUMN process_order_id DROP NOT NULL;

ALTER TABLE erp_production.packing_order
  ADD COLUMN IF NOT EXISTS source_po_type TEXT,
  ADD COLUMN IF NOT EXISTS sku_qty NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS fg_conversion_qty NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS sfg_conversion_qty NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS machine_id UUID REFERENCES erp_master.machine_master(id);

ALTER TABLE erp_production.packing_order_line
  ADD COLUMN IF NOT EXISTS uom_code TEXT,
  ADD COLUMN IF NOT EXISTS movement_type_code TEXT,
  ADD COLUMN IF NOT EXISTS has_alternate BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS material_group_id UUID REFERENCES erp_master.material_category_group(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'packing_order_source_po_type_check'
      AND conrelid = 'erp_production.packing_order'::regclass
  ) THEN
    ALTER TABLE erp_production.packing_order
      ADD CONSTRAINT packing_order_source_po_type_check
      CHECK (source_po_type IS NULL OR source_po_type IN ('MTO','HPS','MTS','ZTEST','MTEST'));
  END IF;
END $$;
