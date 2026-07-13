/*
 * Migration: 20260713103000_gate27_23_packing_po_final_stock_posting
 * Gate: 27.23
 * Purpose: Allow Packing PO FG receipt lines sourced from Pack BOM OUTPUT rows.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_production.packing_order_line
  DROP CONSTRAINT IF EXISTS packing_order_line_line_type_check;

ALTER TABLE erp_production.packing_order_line
  ADD CONSTRAINT packing_order_line_line_type_check
    CHECK (line_type IN ('SFG', 'PM', 'FG'));

COMMIT;
