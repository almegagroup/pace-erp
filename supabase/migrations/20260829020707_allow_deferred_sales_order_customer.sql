-- Direct and Depot SOs resolve their final Ship-To/customer on SO Map.
-- Keep the Sales Order header valid while that later mapping is pending.
ALTER TABLE erp_procurement.sales_order
  ALTER COLUMN customer_id DROP NOT NULL;

COMMENT ON COLUMN erp_procurement.sales_order.customer_id IS
  'Resolved customer. Nullable until SO Map resolves the final Ship-To for Direct/Depot sales orders.';

NOTIFY pgrst, 'reload schema';
