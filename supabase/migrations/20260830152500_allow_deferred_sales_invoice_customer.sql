-- A unified Sales DO may be billed to a parent company that is not a
-- customer-master row. In that valid case the SO still identifies the
-- commercial source, while customer_id remains null.
ALTER TABLE erp_procurement.sales_invoice
  DROP CONSTRAINT IF EXISTS sales_invoice_customer_xor_sto_check;

ALTER TABLE erp_procurement.sales_invoice
  ADD CONSTRAINT sales_invoice_customer_xor_sto_check
  CHECK (
    -- Sales invoices retain the SO link; customer master is optional for
    -- deferred-customer/parent-company billing flows.
    (sto_id IS NULL AND (customer_id IS NOT NULL OR so_id IS NOT NULL))
    -- STO invoices must remain inter-company and cannot carry a customer.
    OR (sto_id IS NOT NULL AND customer_id IS NULL)
  );

NOTIFY pgrst, 'reload schema';
