-- Gate-19 follow-up: Opening Stock page redesign support.
-- 1. rate_per_unit becomes optional (defaults to 0) — WAR engine doesn't exist yet (Section 104,
--    deferred), so opening stock can be posted with a placeholder value and corrected later.
-- 2. is_zero_stock lets a line explicitly declare 0 as a real counted value, distinct from an
--    incomplete/unfilled row.
-- 3. entered_uom_code / entered_quantity preserve what the counter actually typed (which may be a
--    Purchase/Issue UOM, not Base) alongside the Base-UOM quantity used for posting.

ALTER TABLE erp_procurement.opening_stock_line
  ALTER COLUMN rate_per_unit SET DEFAULT 0;

ALTER TABLE erp_procurement.opening_stock_line
  ADD COLUMN IF NOT EXISTS is_zero_stock BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entered_uom_code TEXT,
  ADD COLUMN IF NOT EXISTS entered_quantity NUMERIC;
