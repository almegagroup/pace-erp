-- The FO's selected MM04 site is its eventual dispatch destination.  Keep
-- this nullable for historical FOs that predate the address picker.
ALTER TABLE erp_production.plan_feed
  ADD COLUMN IF NOT EXISTS customer_address_id uuid
    REFERENCES erp_master.customer_address(id);

-- A unified DO can contain several SO/FO destinations, so commercial and
-- consignee data must be frozen per line rather than inferred from the DO
-- header or a mutable SO later in the flow.
ALTER TABLE erp_procurement.delivery_challan_line
  ADD COLUMN IF NOT EXISTS gst_rate numeric,
  ADD COLUMN IF NOT EXISTS gst_amount numeric,
  ADD COLUMN IF NOT EXISTS ship_to_customer_id uuid,
  ADD COLUMN IF NOT EXISTS ship_to_name text,
  ADD COLUMN IF NOT EXISTS ship_to_address text,
  ADD COLUMN IF NOT EXISTS ship_to_state text,
  ADD COLUMN IF NOT EXISTS ship_to_gst_number text;

CREATE INDEX IF NOT EXISTS idx_plan_feed_customer_address
  ON erp_production.plan_feed(customer_address_id)
  WHERE customer_address_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
