BEGIN;

-- Rename plant_id → company_id in machine_master
ALTER TABLE erp_master.machine_master
  RENAME COLUMN plant_id TO company_id;

-- Add cost_center_id (optional, nullable — links to cost_center_master)
ALTER TABLE erp_master.machine_master
  ADD COLUMN IF NOT EXISTS cost_center_id uuid NULL
    REFERENCES erp_master.cost_center_master(id)
    ON DELETE SET NULL;

COMMENT ON COLUMN erp_master.machine_master.company_id IS
  'Company (factory) this machine belongs to.';

COMMENT ON COLUMN erp_master.machine_master.cost_center_id IS
  'Cost center this machine runs under (optional, for L8 costing).';

COMMIT;
