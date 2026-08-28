-- SO Map — FO-based and manual-customer-address-based allocation of SO items.
-- Feasibility doc §133.9 (2026-08-28).

CREATE TABLE erp_procurement.sales_order_map_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_id uuid NOT NULL REFERENCES erp_procurement.sales_order(id),
  so_line_id uuid NOT NULL REFERENCES erp_procurement.sales_order_line(id),
  fo_id uuid REFERENCES erp_production.plan_feed(id),
  customer_address_id uuid REFERENCES erp_master.customer_address(id),
  allocated_qty numeric NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  sku_mismatch_confirmed boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  CONSTRAINT sales_order_map_allocation_status_check CHECK (status IN ('ACTIVE', 'RELEASED')),
  CONSTRAINT sales_order_map_allocation_qty_check CHECK (allocated_qty > 0),
  -- §133.9 — a mapping row is either FO-based or manual-customer-address-based, never both/neither.
  CONSTRAINT sales_order_map_allocation_source_check CHECK (
    (fo_id IS NOT NULL AND customer_address_id IS NULL) OR
    (fo_id IS NULL AND customer_address_id IS NOT NULL)
  )
);

CREATE INDEX idx_sales_order_map_allocation_so_id ON erp_procurement.sales_order_map_allocation(so_id);
CREATE INDEX idx_sales_order_map_allocation_so_line_id ON erp_procurement.sales_order_map_allocation(so_line_id);
CREATE INDEX idx_sales_order_map_allocation_fo_id ON erp_procurement.sales_order_map_allocation(fo_id) WHERE fo_id IS NOT NULL;

COMMENT ON TABLE erp_procurement.sales_order_map_allocation IS
  'SO Map (§133.9) — how much of each SO line is allocated to which FO (Dependent Direct/Depot) or manual Customer Address (no-FO fallback). status=RELEASED on unmap (append-only, history preserved — PR19/COR6 pattern). §133.14''s Dispatch-Reco derivation for RPS-to-Asian dispatches will read fo_id/customer_address_id from here.';
COMMENT ON COLUMN erp_procurement.sales_order_map_allocation.sku_mismatch_confirmed IS
  'FG MTO/HPS/MTEST only (§133.9) — set true when user confirms an SKU-name mismatch warning and maps anyway. Volume/qty limits still apply regardless.';

NOTIFY pgrst, 'reload schema';
