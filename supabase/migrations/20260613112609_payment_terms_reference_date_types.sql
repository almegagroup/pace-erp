BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Reference Date Types master
-- ─────────────────────────────────────────────────────────────
CREATE TABLE erp_master.reference_date_types (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code          VARCHAR(60) NOT NULL UNIQUE,
  label         VARCHAR(120) NOT NULL,
  source_document VARCHAR(20) NOT NULL
    CHECK (source_document IN ('CSN', 'IV', 'MANUAL')),
  source_field  VARCHAR(100),
  description   TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    TEXT        NOT NULL DEFAULT 'SYSTEM'
);

COMMENT ON TABLE erp_master.reference_date_types IS
  'Master list of reference date types used in payment term due date calculation.';
COMMENT ON COLUMN erp_master.reference_date_types.source_document IS
  'Which document the date is pulled from: CSN = Consignment Note, IV = Invoice Verification, MANUAL = user enters manually.';
COMMENT ON COLUMN erp_master.reference_date_types.source_field IS
  'Column name in the source document table.';

-- ─────────────────────────────────────────────────────────────
-- 2. Seed initial reference date types
-- ─────────────────────────────────────────────────────────────
INSERT INTO erp_master.reference_date_types (code, label, source_document, source_field, description) VALUES
  ('BL_DATE',                'BL Date',                  'CSN',    'bl_date',                   'Bill of Lading date — vessel departure for sea shipments'),
  ('LR_DATE',                'LR Date',                  'CSN',    'lr_date',                   'Lorry Receipt date — truck departure for domestic/road shipments'),
  ('POST_CLEARANCE_LR_DATE', 'Post-Clearance LR Date',   'CSN',    'post_clearance_lr_date',    'LR date after customs clearance, port → plant leg'),
  ('ATA_AT_PORT',            'ATA at Port',              'CSN',    'ata_at_port',               'Actual Time of Arrival at destination port'),
  ('GRN_DATE',               'GRN Date',                 'CSN',    'grn_date',                  'Goods Receipt Note date — goods received at plant'),
  ('INVOICE_DATE',           'Invoice Date',             'IV',     'vendor_invoice_date',       'Vendor invoice date from Invoice Verification'),
  ('MANUAL',                 'Manual Entry',             'MANUAL', NULL,                        'User enters the reference date manually at payment time');

-- ─────────────────────────────────────────────────────────────
-- 3. Alter payment_terms_master
--    reference_date TEXT → reference_date_type_id UUID FK
--    Table is empty — no data migration needed
-- ─────────────────────────────────────────────────────────────
ALTER TABLE erp_master.payment_terms_master
  DROP COLUMN reference_date;

ALTER TABLE erp_master.payment_terms_master
  ADD COLUMN reference_date_type_id UUID NOT NULL
    REFERENCES erp_master.reference_date_types(id) ON DELETE RESTRICT;

-- ─────────────────────────────────────────────────────────────
-- 4. CHECK constraint on payment_method
-- ─────────────────────────────────────────────────────────────
ALTER TABLE erp_master.payment_terms_master
  ADD CONSTRAINT chk_payment_terms_method
    CHECK (payment_method IN ('CREDIT', 'ADVANCE', 'LC', 'TT', 'DA', 'DP', 'MIXED'));

COMMIT;
