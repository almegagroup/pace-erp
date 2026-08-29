-- §133.9: a Depot is a valid fixed SO Map destination in its own right.
-- Allocation quantities remain canonical base quantities; the UI converts
-- pack-based input before it reaches this table.
BEGIN;

ALTER TABLE erp_procurement.sales_order_map_allocation
  ADD COLUMN IF NOT EXISTS depot_code_id uuid
    REFERENCES erp_master.fg_depot_code(id);

ALTER TABLE erp_procurement.sales_order_map_allocation
  DROP CONSTRAINT IF EXISTS sales_order_map_allocation_source_check;

ALTER TABLE erp_procurement.sales_order_map_allocation
  ADD CONSTRAINT sales_order_map_allocation_source_check CHECK (
    (fo_id IS NOT NULL AND customer_address_id IS NULL AND depot_code_id IS NULL) OR
    (fo_id IS NULL AND customer_address_id IS NOT NULL AND depot_code_id IS NULL) OR
    (fo_id IS NULL AND customer_address_id IS NULL AND depot_code_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_sales_order_map_allocation_depot_code_id
  ON erp_procurement.sales_order_map_allocation(depot_code_id)
  WHERE depot_code_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE
ON erp_procurement.sales_order_map_allocation
TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
