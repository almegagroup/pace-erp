/*
 * File-ID: 12.6
 * File-Path: supabase/migrations/20260509125000_gate12_12_6_create_vendor_master.sql
 * Gate: 12
 * Phase: 12
 * Domain: MASTER
 * Purpose: Create the vendor master and vendor-company mapping tables without static payment terms.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.vendor_master (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated. Format: V-00001
  vendor_code             text NOT NULL UNIQUE,

  vendor_name             text NOT NULL,

  -- DOMESTIC | IMPORT
  vendor_type             text NOT NULL
    CHECK (vendor_type IN ('DOMESTIC', 'IMPORT')),

  -- IDENTITY
  -- Domestic: BIN number (triggers GST API auto-fill)
  bin_number              text NULL,
  tin_number              text NULL,
  trade_license           text NULL,

  -- GST (Domestic)
  gst_number              text NULL,
  gst_category            text NULL,

  -- Import
  iec_code                text NULL,
  import_license          text NULL,

  -- ADDRESS
  registered_address      text NULL,
  correspondence_address  text NULL,

  -- CONTACT
  primary_contact_person  text NULL,
  phone                   text NULL,
  primary_email           text NULL,

  -- Array of CC email addresses for PO auto-mail
  cc_email_list           text[] NULL DEFAULT ARRAY[]::text[],

  -- BANK (optional now, mandatory later)
  bank_name               text NULL,
  bank_branch             text NULL,
  bank_account_number     text NULL,
  bank_routing_number     text NULL,

  -- CURRENCY
  -- Auto: BDT for DOMESTIC, must be set for IMPORT
  currency_code           text NOT NULL DEFAULT 'BDT',

  -- STATUS
  -- DRAFT -> PENDING_APPROVAL -> ACTIVE -> INACTIVE | BLOCKED
  status                  text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'BLOCKED')),

  -- AUDIT
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL,
  approved_by             uuid NULL,
  approved_at             timestamptz NULL,
  last_updated_at         timestamptz NULL,
  last_updated_by         uuid NULL
);

COMMENT ON TABLE erp_master.vendor_master IS
'Vendor identity record. DOMESTIC or IMPORT only. No static payment_terms field - use vendor_payment_terms_log for dynamic last-used terms.';

COMMENT ON COLUMN erp_master.vendor_master.cc_email_list IS
'Array of CC email addresses. All are CC''d when PO is auto-mailed to vendor.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vm_vendor_code ON erp_master.vendor_master (vendor_code);
CREATE INDEX IF NOT EXISTS idx_vm_status ON erp_master.vendor_master (status);
CREATE INDEX IF NOT EXISTS idx_vm_gst ON erp_master.vendor_master (gst_number) WHERE gst_number IS NOT NULL;

-- Vendor Company Mapping
CREATE TABLE IF NOT EXISTS erp_master.vendor_company_map (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   uuid NOT NULL
    REFERENCES erp_master.vendor_master(id)
    ON DELETE RESTRICT,
  company_id  uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NULL,

  UNIQUE (vendor_id, company_id)
);

COMMENT ON TABLE erp_master.vendor_company_map IS
'A vendor can be active in multiple companies. This table maps which companies a vendor is active for.';

COMMIT;
