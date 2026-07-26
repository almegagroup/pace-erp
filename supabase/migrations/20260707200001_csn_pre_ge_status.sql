-- Track CSN status before GE attachment so prune can restore it
ALTER TABLE erp_procurement.consignment_note
  ADD COLUMN IF NOT EXISTS pre_ge_status text;
