BEGIN;

ALTER TABLE erp_production.stroke_master
  ADD COLUMN IF NOT EXISTS communication_date date NULL,
  ADD COLUMN IF NOT EXISTS communication_type text NULL,
  ADD COLUMN IF NOT EXISTS communicator_name text NULL,
  ADD COLUMN IF NOT EXISTS communication_reference text NULL;

ALTER TABLE erp_production.stroke_master
  DROP CONSTRAINT IF EXISTS stroke_master_communication_type_check;

ALTER TABLE erp_production.stroke_master
  ADD CONSTRAINT stroke_master_communication_type_check
  CHECK (communication_type IS NULL OR communication_type IN ('EMAIL', 'WHATSAPP', 'VERBAL_COMMUNICATION'));

COMMIT;
