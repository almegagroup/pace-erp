BEGIN;

ALTER TABLE erp_procurement.consignment_note
  ADD COLUMN IF NOT EXISTS boe_date date NULL;

COMMIT;
