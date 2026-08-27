-- File-Path: supabase/migrations/20260827100000_mm04_dependent_flag_origin_company.sql
-- Purpose: feasibility doc Section 132 (132.5, 132.9) -- MM04 becomes the single
--          unified Customer Master. Adds:
--            1. customer_master.is_dependent -- derived boolean, TRUE when at
--               least one customer_address row is VDC-mapped (depot_code_id
--               NOT NULL). Backend recomputes this on every address-mapping
--               write (see customer_address.handlers.ts); it is never set
--               directly by the user.
--            2. customer_master.origin_company_id -- which company this
--               customer was first created under. Nullable: 2 pre-existing
--               dev customers (C-00004, C-00006) have zero
--               customer_company_map rows and cannot be backfilled without
--               guessing -- left NULL deliberately. Every customer created
--               going forward always gets this set at create time.
-- Authority: Backend

ALTER TABLE erp_master.customer_master
  ADD COLUMN IF NOT EXISTS is_dependent boolean NOT NULL DEFAULT false;

ALTER TABLE erp_master.customer_master
  ADD COLUMN IF NOT EXISTS origin_company_id uuid REFERENCES erp_master.companies(id);

CREATE INDEX IF NOT EXISTS idx_customer_master_is_dependent
  ON erp_master.customer_master(is_dependent);

-- Backfill is_dependent from existing customer_address mappings.
UPDATE erp_master.customer_master cm
SET is_dependent = EXISTS (
  SELECT 1 FROM erp_master.customer_address ca
  WHERE ca.customer_id = cm.id AND ca.depot_code_id IS NOT NULL
);

-- Backfill origin_company_id from each customer's earliest company mapping.
-- Deliberately leaves NULL where no mapping exists at all (see header note).
UPDATE erp_master.customer_master cm
SET origin_company_id = sub.company_id
FROM (
  SELECT DISTINCT ON (customer_id) customer_id, company_id
  FROM erp_master.customer_company_map
  ORDER BY customer_id, created_at ASC
) sub
WHERE sub.customer_id = cm.id;
