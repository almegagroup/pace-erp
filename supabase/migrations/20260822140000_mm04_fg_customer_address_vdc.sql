-- File-Path: supabase/migrations/20260822140000_mm04_fg_customer_address_vdc.sql
-- Purpose: MM04 -> FG Customer Master redesign (feasibility doc Section 129).
--   1) erp_master.customer_address -- one row per customer site/address.
--      depot_code_id is nullable by design (staged completion, §129.3) --
--      do NOT copy fg_dispatch_customer_address's NOT NULL depot_code_id.
--   2) erp_master.fg_depot_code.gst_number -- VDC's own optional GST (§129.5),
--      column did not exist before this migration.
--   3) Structural backfill of existing 64 customers into one customer_address
--      row each (site_name/depot_code_id left NULL -- Stage 2 data genuinely
--      does not exist and cannot be derived, §129.3).
-- Authority: Backend (feasibility doc Section 129, LOCKED 2026-08-22)

CREATE TABLE erp_master.customer_address (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES erp_master.customer_master(id),
  site_name text,
  address_line text NOT NULL,
  town text,
  state text NOT NULL,
  pin_code text,
  depot_code_id uuid REFERENCES erp_master.fg_depot_code(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz
);

CREATE INDEX idx_customer_address_customer_id ON erp_master.customer_address(customer_id);
CREATE INDEX idx_customer_address_depot_code_id ON erp_master.customer_address(depot_code_id);

ALTER TABLE erp_master.fg_depot_code ADD COLUMN gst_number text;

-- Structural backfill only (§129.3) -- site_name/depot_code_id intentionally NULL.
INSERT INTO erp_master.customer_address
  (customer_id, address_line, town, state, created_by)
SELECT
  id,
  delivery_address,
  NULLIF(town, ''),
  billing_state,
  created_by
FROM erp_master.customer_master
WHERE delivery_address IS NOT NULL
  AND delivery_address <> ''
  AND billing_state IS NOT NULL
  AND billing_state <> '';
