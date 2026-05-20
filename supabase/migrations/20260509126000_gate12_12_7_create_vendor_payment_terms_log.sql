/*
 * File-ID: 12.7
 * File-Path: supabase/migrations/20260509126000_gate12_12_7_create_vendor_payment_terms_log.sql
 * Gate: 12
 * Phase: 12
 * Domain: MASTER
 * Purpose: Create the vendor payment terms history log with a latest-terms descending index.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.vendor_payment_terms_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  vendor_id           uuid NOT NULL
    REFERENCES erp_master.vendor_master(id)
    ON DELETE RESTRICT,

  company_id          uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,

  -- e.g. 30, 45, 60, 90 (days net)
  payment_terms_days  int NOT NULL CHECK (payment_terms_days >= 0),

  -- e.g. BANK_TRANSFER, CHEQUE, LC, TT, ADVANCE
  payment_method      text NULL,

  -- Additional terms notes
  terms_notes         text NULL,

  -- The PO that established these terms (NULL for manually entered)
  -- References erp_procurement.purchase_order when that table exists
  reference_po_id     uuid NULL,

  recorded_at         timestamptz NOT NULL DEFAULT now(),
  recorded_by         uuid NOT NULL
);

COMMENT ON TABLE erp_master.vendor_payment_terms_log IS
'Dynamic payment terms history per vendor per company. Latest record = last-used default for next PO. No static terms on vendor_master.';

-- Index for fast lookup of latest terms per vendor+company
CREATE INDEX IF NOT EXISTS idx_vptl_vendor_company_latest
  ON erp_master.vendor_payment_terms_log (vendor_id, company_id, recorded_at DESC);

COMMIT;
