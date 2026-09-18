/*
 * File-Path: supabase/migrations/20260917140000_mts_page3_shift_batch_range.sql
 * Domain: PRODUCTION
 * Purpose: MTS Process PO Create (Page 3) redesign -- Shift master (company-wise,
 *          inline-create-as-you-go) + batch-range/production-date columns on
 *          process_order. MTO/HPS/MTEST are untouched -- every new column is
 *          nullable and only ever populated for po_type='MTS'.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_production.shift_master (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES erp_master.companies(id),
  shift_name   TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, shift_name)
);

GRANT ALL ON TABLE erp_production.shift_master TO service_role;

COMMENT ON TABLE erp_production.shift_master IS
'MTS Process PO Create (Page 3) Shift field -- company-wise, inline-create-as-you-go from the Process PO Create page itself (no dedicated SA screen). No production_mode concept here; a plain company-scoped name list.';

-- MTS-only batch-range + production-date fields on process_order. Nullable so
-- MTO/HPS/MTEST/pre-existing MTS rows are completely unaffected.
ALTER TABLE erp_production.process_order
  ADD COLUMN IF NOT EXISTS production_date     DATE,
  ADD COLUMN IF NOT EXISTS shift_id            UUID REFERENCES erp_production.shift_master(id),
  ADD COLUMN IF NOT EXISTS batch_number_from   TEXT,
  ADD COLUMN IF NOT EXISTS batch_number_to     TEXT,
  ADD COLUMN IF NOT EXISTS number_of_batches   INTEGER;

COMMENT ON COLUMN erp_production.process_order.production_date IS
'MTS Page 3 "Date" -- declared physical-production date, user-entered (current-3..current, no future). Informational only; posting_date at Verify uses this value directly as a label (same pattern as the existing URGENT priority Current-1 label, §136) -- never derived from it here.';
COMMENT ON COLUMN erp_production.process_order.shift_id IS
'MTS Page 3 "Shift" -- FK to shift_master. NULL for MTO/HPS/MTEST.';
COMMENT ON COLUMN erp_production.process_order.batch_number_from IS
'MTS Page 3 batch range start (formatted, e.g. PT00035). Mirrors process_order.batch_number (also set to this same value for MTS so existing display code needs no branching). NULL for MTO/HPS/MTEST.';
COMMENT ON COLUMN erp_production.process_order.batch_number_to IS
'MTS Page 3 batch range end (formatted) = batch_number_from + number_of_batches - 1. NULL for MTO/HPS/MTEST.';
COMMENT ON COLUMN erp_production.process_order.number_of_batches IS
'MTS Page 3 batch count for this declaration. Each individual batch number in the range still gets its own erp_production.batch_number_instance row (source_process_order_id = this PO), for company-wide duplicate-checking and audit history. NULL for MTO/HPS/MTEST.';

COMMIT;
