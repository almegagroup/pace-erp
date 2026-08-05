-- opening_stock_line_quantity_check blocked quantity = 0 unconditionally, even when
-- is_zero_stock = true — a case the handler (addOpeningStockLineHandler) explicitly
-- supports (quantity may be 0 only when is_zero_stock is true). Any bulk/single
-- Opening Stock entry ticking "Zero Stock" hit this CHECK and failed with a generic
-- 500 OPENING_STOCK_LINE_CREATE_FAILED. Replace with a constraint that matches the
-- actual business rule: quantity > 0 for normal rows, quantity = 0 only for
-- zero-stock rows.

ALTER TABLE erp_procurement.opening_stock_line
  DROP CONSTRAINT opening_stock_line_quantity_check;

ALTER TABLE erp_procurement.opening_stock_line
  ADD CONSTRAINT opening_stock_line_quantity_check
  CHECK (
    (is_zero_stock = false AND quantity > 0)
    OR (is_zero_stock = true AND quantity = 0)
  );
