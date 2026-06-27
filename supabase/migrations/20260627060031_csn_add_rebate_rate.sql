ALTER TABLE erp_procurement.consignment_note
  ADD COLUMN IF NOT EXISTS rebate_rate numeric(18, 6) NULL;
