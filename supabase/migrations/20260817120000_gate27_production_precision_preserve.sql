-- Gate 27 | Production precision preservation
-- Preserve operator-entered decimal precision from Stroke Master through
-- Process/Packing Final/Verify instead of forcing 4-decimal storage.

ALTER TABLE erp_production.stroke_line
  ALTER COLUMN dosage_pct TYPE NUMERIC;

ALTER TABLE erp_production.process_order
  ALTER COLUMN planned_qty TYPE NUMERIC,
  ALTER COLUMN actual_qty TYPE NUMERIC;

ALTER TABLE erp_production.process_order_line
  ALTER COLUMN planned_qty TYPE NUMERIC,
  ALTER COLUMN actual_qty TYPE NUMERIC;

ALTER TABLE erp_production.packing_order
  ALTER COLUMN fill_qty_per_pack TYPE NUMERIC,
  ALTER COLUMN planned_qty_kg TYPE NUMERIC,
  ALTER COLUMN total_qty_kg TYPE NUMERIC,
  ALTER COLUMN actual_qty_kg TYPE NUMERIC,
  ALTER COLUMN sku_qty TYPE NUMERIC,
  ALTER COLUMN fg_conversion_qty TYPE NUMERIC,
  ALTER COLUMN sfg_conversion_qty TYPE NUMERIC;

ALTER TABLE erp_production.packing_order_line
  ALTER COLUMN qty_per_pack TYPE NUMERIC,
  ALTER COLUMN total_qty TYPE NUMERIC,
  ALTER COLUMN actual_qty TYPE NUMERIC;
