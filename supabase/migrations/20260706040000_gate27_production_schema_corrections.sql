/*
 * Migration: 20260706040000_gate27_production_schema_corrections
 * Gate: 27
 * Purpose: Corrective additions to erp_production tables after initial schema review.
 *          Adds columns required by handler implementations:
 *          - process_order: notes, qa_rejection_reason, fg_stock_ledger_id, batch_started_by
 *          - process_order_line: is_rm, uom_code, stock_ledger_id
 *          - plan_feed: sku, cancelled_by; makes material_id nullable
 *          - packing_order: total_qty_kg
 */

-- process_order additions
ALTER TABLE erp_production.process_order
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS qa_rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS fg_stock_ledger_id UUID REFERENCES erp_inventory.stock_ledger(id),
  ADD COLUMN IF NOT EXISTS batch_started_by UUID REFERENCES auth.users(id);

-- process_order_line additions
ALTER TABLE erp_production.process_order_line
  ADD COLUMN IF NOT EXISTS is_rm BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS uom_code TEXT NOT NULL DEFAULT 'KG',
  ADD COLUMN IF NOT EXISTS stock_ledger_id UUID REFERENCES erp_inventory.stock_ledger(id);

-- plan_feed: add sku, make material_id nullable, add cancelled_by
ALTER TABLE erp_production.plan_feed
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id);

ALTER TABLE erp_production.plan_feed
  ALTER COLUMN material_id DROP NOT NULL;

-- packing_order additions
ALTER TABLE erp_production.packing_order
  ADD COLUMN IF NOT EXISTS total_qty_kg NUMERIC(14,4);
