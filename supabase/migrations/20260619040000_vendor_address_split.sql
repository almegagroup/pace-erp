-- Split vendor_master address into separate fields for filtering.
-- Also expose generate_vendor_code via erp_master schema for direct service-role call.

BEGIN;

-- Registered address fields
ALTER TABLE erp_master.vendor_master
  ADD COLUMN IF NOT EXISTS reg_address_line1  text,
  ADD COLUMN IF NOT EXISTS reg_address_city   text,
  ADD COLUMN IF NOT EXISTS reg_address_state  text,
  ADD COLUMN IF NOT EXISTS reg_address_pin    text;

-- Correspondence address fields
ALTER TABLE erp_master.vendor_master
  ADD COLUMN IF NOT EXISTS corr_address_line1 text,
  ADD COLUMN IF NOT EXISTS corr_address_city  text,
  ADD COLUMN IF NOT EXISTS corr_address_state text,
  ADD COLUMN IF NOT EXISTS corr_address_pin   text;

-- Migrate existing data into new columns (line1 gets old full text)
UPDATE erp_master.vendor_master
SET reg_address_line1  = registered_address,
    corr_address_line1 = correspondence_address
WHERE registered_address IS NOT NULL OR correspondence_address IS NOT NULL;

-- Drop old single-text columns
ALTER TABLE erp_master.vendor_master
  DROP COLUMN IF EXISTS registered_address,
  DROP COLUMN IF EXISTS correspondence_address;

COMMIT;
