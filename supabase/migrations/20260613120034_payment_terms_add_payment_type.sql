-- Add payment_type column to payment_terms_master.
-- payment_method is now CREDIT | ADVANCE only.
-- payment_type carries the instrument: LC, TT, DA, DP, MIXED, N_A.

ALTER TABLE erp_master.payment_terms_master
  DROP CONSTRAINT IF EXISTS chk_payment_terms_method,
  DROP CONSTRAINT IF EXISTS payment_terms_master_payment_method_check;

ALTER TABLE erp_master.payment_terms_master
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'N_A';

ALTER TABLE erp_master.payment_terms_master
  ADD CONSTRAINT chk_payment_terms_method
    CHECK (payment_method IN ('CREDIT', 'ADVANCE')),
  ADD CONSTRAINT chk_payment_terms_payment_type
    CHECK (payment_type IN ('LC', 'TT', 'DA', 'DP', 'MIXED', 'N_A'));
