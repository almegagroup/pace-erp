-- §133.9: one FO/Ship-To selection owns a reusable group of SO item rows.
BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.sales_order_map_group (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_id uuid NOT NULL REFERENCES erp_procurement.sales_order(id),
  fo_id uuid REFERENCES erp_production.plan_feed(id),
  customer_address_id uuid REFERENCES erp_master.customer_address(id),
  depot_code_id uuid REFERENCES erp_master.fg_depot_code(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  CONSTRAINT sales_order_map_group_destination_check CHECK (
    (fo_id IS NOT NULL AND customer_address_id IS NULL AND depot_code_id IS NULL) OR
    (fo_id IS NULL AND customer_address_id IS NOT NULL AND depot_code_id IS NULL) OR
    (fo_id IS NULL AND customer_address_id IS NULL AND depot_code_id IS NOT NULL)
  )
);

ALTER TABLE erp_procurement.sales_order_map_allocation
  ADD COLUMN IF NOT EXISTS map_group_id uuid REFERENCES erp_procurement.sales_order_map_group(id);

CREATE INDEX IF NOT EXISTS idx_sales_order_map_group_so_active
  ON erp_procurement.sales_order_map_group(so_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_order_map_allocation_group
  ON erp_procurement.sales_order_map_allocation(map_group_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON erp_procurement.sales_order_map_group TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
