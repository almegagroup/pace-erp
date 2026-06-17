-- Transit days snapshot on CSN
-- Stores the port_plant_transit_master.transit_days value at the time
-- port_of_discharge_id is first assigned. ETA calculation uses this
-- snapshot instead of live master lookup, so changing the master does
-- not retroactively affect in-transit shipments. Can be manually
-- overridden per CSN via the detail page.

ALTER TABLE erp_procurement.consignment_note
  ADD COLUMN transit_days_snapshot INTEGER NULL;

COMMENT ON COLUMN erp_procurement.consignment_note.transit_days_snapshot IS
  'Snapshot of port_plant_transit_master.transit_days captured when port_of_discharge_id is first assigned. Used for ETA calculation instead of live master lookup, so master changes do not retroactively affect in-transit CSNs. Can be manually overridden per CSN.';
