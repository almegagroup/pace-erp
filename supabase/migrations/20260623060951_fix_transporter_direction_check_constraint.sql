-- The transporter_master_usage_direction_check constraint still enforced
-- the old INBOUND/OUTBOUND/BOTH values after the application code was
-- changed to IMPORT/DOMESTIC/BOTH (matching the terminology used
-- everywhere else in this codebase). Every create with Direction=IMPORT
-- or DOMESTIC was failing with a DB-level 500, not the 400 the app code
-- expected, because the table-level CHECK was never updated alongside it.

ALTER TABLE erp_master.transporter_master
  DROP CONSTRAINT transporter_master_usage_direction_check;

ALTER TABLE erp_master.transporter_master
  ADD CONSTRAINT transporter_master_usage_direction_check
  CHECK (usage_direction = ANY (ARRAY['IMPORT'::text, 'DOMESTIC'::text, 'BOTH'::text]));
