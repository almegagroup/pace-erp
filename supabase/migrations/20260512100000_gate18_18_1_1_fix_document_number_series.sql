/*
 * File-ID: 18.1.1
 * File-Path: supabase/migrations/20260512100000_gate18_18_1_1_fix_document_number_series.sql
 * Gate: 18
 * Phase: 18
 * Domain: PROCUREMENT
 * Purpose: Add starting_number to global procurement number series and align seeded doc types.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_procurement.document_number_series
  ADD COLUMN IF NOT EXISTS starting_number bigint NOT NULL DEFAULT 1;

DELETE FROM erp_procurement.document_number_series
WHERE doc_type = 'STO';

INSERT INTO erp_procurement.document_number_series (doc_type, pad_width, starting_number)
VALUES ('SALES_INVOICE', 6, 1)
ON CONFLICT (doc_type) DO NOTHING;

UPDATE erp_procurement.document_number_series
SET starting_number = 1
WHERE starting_number IS NULL;

COMMIT;
