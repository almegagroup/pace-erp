-- §119.8 multi-UoM count entry — physical_inventory_item.entered_uom_code/entered_qty were
-- referenced by enterCountHandler (physical_inventory.handlers.ts) from the original 2026-08-13
-- PID redesign migration but never actually added to the table, causing every count-save with a
-- non-empty UomQuantityInput selection to fail with PI_COUNT_SAVE_FAILED (500) — found live
-- 2026-08-14 during click-through testing. Same shape as IN05 Opening Stock's own
-- entered_uom_code/entered_quantity pair (20260712150000), just this table's own columns.

ALTER TABLE erp_procurement.physical_inventory_item
  ADD COLUMN IF NOT EXISTS entered_uom_code TEXT,
  ADD COLUMN IF NOT EXISTS entered_qty NUMERIC;
