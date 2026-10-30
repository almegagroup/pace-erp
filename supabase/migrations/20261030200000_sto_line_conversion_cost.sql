-- FG STO valuation = Transfer price + Conversion cost (AC04). The conversion cost per KG is resolved
-- once, server-side, when the FG STO is created (AC04 resolve_conversion_rate for the SKU's prodshade
-- and segment as of the STO date, sending company) and stored on the line; the DO / invoice rate and the
-- receiver's GRN rate are then transfer_price + conversion_cost_per_unit. NULL = no conversion cost
-- (every RM / PM / INT STO line).
ALTER TABLE erp_procurement.stock_transfer_order_line
  ADD COLUMN IF NOT EXISTS conversion_cost_per_unit numeric(18,6) NULL;

COMMENT ON COLUMN erp_procurement.stock_transfer_order_line.conversion_cost_per_unit IS
'AC04 conversion cost per base unit (KG) added to transfer_price for FG STO lines; NULL for non-FG STO lines.';
