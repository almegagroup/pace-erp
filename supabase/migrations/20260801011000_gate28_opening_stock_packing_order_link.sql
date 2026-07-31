/*
 * File-Path: supabase/migrations/20260801011000_gate28_opening_stock_packing_order_link.sql
 * Purpose: Add optional packing_order linkage for FG opening stock lines so IN05/IN06
 *          can anchor opening FG rows to PR23 genealogy instead of free-typed batch only.
 * Authority: DBA
 */

ALTER TABLE erp_procurement.opening_stock_line
  ADD COLUMN IF NOT EXISTS packing_order_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'opening_stock_line_packing_order_id_fkey'
  ) THEN
    ALTER TABLE erp_procurement.opening_stock_line
      ADD CONSTRAINT opening_stock_line_packing_order_id_fkey
      FOREIGN KEY (packing_order_id)
      REFERENCES erp_production.packing_order(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_opening_stock_line_packing_order_id
  ON erp_procurement.opening_stock_line (packing_order_id);

COMMENT ON COLUMN erp_procurement.opening_stock_line.packing_order_id IS
  'Optional PR23 genealogy link for FG opening lines; batch_number is derived from the linked packing_order.';
