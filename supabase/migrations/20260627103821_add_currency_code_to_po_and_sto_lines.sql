ALTER TABLE erp_procurement.purchase_order_line ADD COLUMN currency_code text NOT NULL DEFAULT 'INR';
ALTER TABLE erp_procurement.purchase_order_line
  ADD CONSTRAINT purchase_order_line_currency_code_check CHECK (currency_code = ANY (ARRAY['INR','USD']));

ALTER TABLE erp_procurement.stock_transfer_order_line ADD COLUMN currency_code text NOT NULL DEFAULT 'INR';
ALTER TABLE erp_procurement.stock_transfer_order_line
  ADD CONSTRAINT stock_transfer_order_line_currency_code_check CHECK (currency_code = ANY (ARRAY['INR','USD']));
