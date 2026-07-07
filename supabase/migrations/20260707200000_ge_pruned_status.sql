-- Add PRUNED to gate_entry status CHECK constraint
ALTER TABLE erp_procurement.gate_entry
  DROP CONSTRAINT IF EXISTS gate_entry_status_check;

ALTER TABLE erp_procurement.gate_entry
  ADD CONSTRAINT gate_entry_status_check
  CHECK (status IN ('OPEN', 'GRN_POSTED', 'CANCELLED', 'PRUNED'));
