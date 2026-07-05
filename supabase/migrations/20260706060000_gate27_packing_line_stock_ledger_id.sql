/*
 * Migration: 20260706060000_gate27_packing_line_stock_ledger_id
 * Gate: 27
 * Purpose: Add stock_ledger_id to packing_order_line so PM P261 postings can be
 *          tracked per line and reversed (P262) when a FINAL packing order is reversed.
 */
ALTER TABLE erp_production.packing_order_line
  ADD COLUMN IF NOT EXISTS stock_ledger_id UUID REFERENCES erp_inventory.stock_ledger(id);
