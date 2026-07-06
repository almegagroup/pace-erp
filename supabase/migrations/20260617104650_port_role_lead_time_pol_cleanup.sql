-- OM08: Add port_role to port_master (DISCHARGE / LOADING / BOTH)
ALTER TABLE erp_master.port_master
  ADD COLUMN port_role TEXT NOT NULL DEFAULT 'DISCHARGE'
    CHECK (port_role IN ('DISCHARGE', 'LOADING', 'BOTH'));

-- All existing ports are discharge ports
UPDATE erp_master.port_master SET port_role = 'DISCHARGE' WHERE port_role = 'DISCHARGE';

-- OM10: Remove port_of_loading from lead_time_master_import
-- (design decision: lookup key is Vendor + Material Category + Port of Discharge only)
ALTER TABLE erp_master.lead_time_master_import
  DROP COLUMN IF EXISTS port_of_loading;

-- CSN: Replace port_of_loading (free text) with port_of_loading_id (FK to port_master)
ALTER TABLE erp_procurement.consignment_note
  DROP COLUMN IF EXISTS port_of_loading;

ALTER TABLE erp_procurement.consignment_note
  ADD COLUMN port_of_loading_id UUID NULL
    REFERENCES erp_master.port_master(id);
