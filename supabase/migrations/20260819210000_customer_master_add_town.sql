-- Business owner request (2026-08-19): Customer Master needs a "Town" field,
-- distinct from the existing free-text delivery_address/billing_address and
-- billing_state -- a short, searchable location field, same shape as
-- vendor_master's reg_address_city/corr_address_city but simpler (customer
-- has one address concept, not registered-vs-correspondence).

ALTER TABLE erp_master.customer_master
  ADD COLUMN IF NOT EXISTS town text;
