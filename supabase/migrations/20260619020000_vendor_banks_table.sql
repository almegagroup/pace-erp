/*
 * Purpose: Add vendor_banks table (multi-bank support with active/primary flags),
 *          drop flat bank columns from vendor_master.
 */

BEGIN;

-- Drop old flat bank columns from vendor_master
ALTER TABLE erp_master.vendor_master
  DROP COLUMN IF EXISTS bank_name,
  DROP COLUMN IF EXISTS bank_branch,
  DROP COLUMN IF EXISTS bank_account_number,
  DROP COLUMN IF EXISTS bank_routing_number;

-- vendor_banks table
CREATE TABLE IF NOT EXISTS erp_master.vendor_banks (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id           uuid        NOT NULL REFERENCES erp_master.vendor_master(id) ON DELETE CASCADE,
  bank_name           text        NOT NULL,
  bank_branch         text,
  bank_account_number text,
  bank_routing_number text,
  is_primary          boolean     NOT NULL DEFAULT false,
  is_active           boolean     NOT NULL DEFAULT true,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_banks_vendor_id
  ON erp_master.vendor_banks (vendor_id);

COMMIT;
