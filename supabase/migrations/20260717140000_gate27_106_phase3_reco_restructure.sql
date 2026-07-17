/*
 * File-Path: supabase/migrations/20260717140000_gate27_106_phase3_reco_restructure.sql
 * Gate: 27.106
 * Domain: PRODUCTION / RECO-COSTING
 * Purpose: Section 106 Phase 3 (§106.6) — give the Reco/Costing layer its own year-scoped
 *   document identity and make return/reversal rows distinguishable from production rows.
 *
 *   Today process_order_line_reco is a flat costing record with no document number, no
 *   transaction-type marker and no reference, so a RETURN or PARTIAL_REVERSAL row could not
 *   be told apart from the original PRODUCTION row and SUM()-based costing would silently
 *   mix them. This adds:
 *     - reco_document_number + reco_document_year : the L3 Costing-document identity
 *       (SAP CO doc = BELNR + GJAHR), year-scoped from the same System-C engine.
 *     - source_txn_type : which event produced the row.
 *     - reference_document_number/type : the triggering business document.
 *
 *   Credit convention (§106.6): RETURN / PARTIAL_REVERSAL rows carry NEGATIVE
 *   actual/ap_approved/variance quantities, so net costing = SUM() reconciles
 *   production − returns naturally, and reporting can split by source_txn_type.
 *
 *   Non-breaking: every existing row is production output from Verify, so
 *   source_txn_type defaults to 'PRODUCTION' and backfills correctly; the new document
 *   columns are nullable/'' for rows that predate the Reco-document layer.
 * Authority: Backend / DB
 */

-- 1. L3 Costing-document identity (BELNR + GJAHR equivalent)
ALTER TABLE erp_production.process_order_line_reco
  ADD COLUMN IF NOT EXISTS reco_document_number text;

ALTER TABLE erp_production.process_order_line_reco
  ADD COLUMN IF NOT EXISTS reco_document_year text NOT NULL DEFAULT '';

-- 2. Which event produced this row. Existing rows are all Verify-time production output.
ALTER TABLE erp_production.process_order_line_reco
  ADD COLUMN IF NOT EXISTS source_txn_type text NOT NULL DEFAULT 'PRODUCTION';

ALTER TABLE erp_production.process_order_line_reco
  DROP CONSTRAINT IF EXISTS process_order_line_reco_source_txn_type_check;

ALTER TABLE erp_production.process_order_line_reco
  ADD CONSTRAINT process_order_line_reco_source_txn_type_check
  CHECK (source_txn_type IN ('PRODUCTION', 'RETURN', 'PARTIAL_REVERSAL', 'COR6_CORRECTION'));

-- 3. Triggering business document (Process PO / Return Receipt / PR19 reversal doc ...)
ALTER TABLE erp_production.process_order_line_reco
  ADD COLUMN IF NOT EXISTS reference_document_number text;

ALTER TABLE erp_production.process_order_line_reco
  ADD COLUMN IF NOT EXISTS reference_document_type text;

-- 4. Reporting/query paths: split by event type, and pull one costing document.
CREATE INDEX IF NOT EXISTS idx_reco_source_txn_type
  ON erp_production.process_order_line_reco(source_txn_type);

CREATE INDEX IF NOT EXISTS idx_reco_document
  ON erp_production.process_order_line_reco(reco_document_number, reco_document_year);

CREATE INDEX IF NOT EXISTS idx_reco_reference_document
  ON erp_production.process_order_line_reco(reference_document_number);
