-- Gate Exit (gate_exit_inbound) gets the same person_name mechanism Gate Entry
-- already has: Security department users must type the physical guard's name
-- manually; everyone else auto-resolves to their own signup name. See
-- gate_entry.person_name (already live) for the existing pattern this mirrors.
ALTER TABLE erp_procurement.gate_exit_inbound
  ADD COLUMN IF NOT EXISTS person_name text;
