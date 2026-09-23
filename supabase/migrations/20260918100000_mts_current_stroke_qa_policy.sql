/*
 * File-Path: supabase/migrations/20260918100000_mts_current_stroke_qa_policy.sql
 * Domain: PRODUCTION
 * Purpose: MTS Current-vs-Non-Current Stroke QA policy (2026-09-17 lock).
 *          `mts_used_current_stroke` records, at Create time, whether the PO
 *          used its Prodshade's Current Stroke (Policy 1 — skips QA approval,
 *          no Start Batch, finalize straight from STANDARD) or a different
 *          stroke (Policy 2 — classic Standard -> QA Approved -> Final ->
 *          Verify, same as MTO/HPS, minus the Start Batch step). NULL for
 *          every non-MTS po_type.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_production.process_order
  ADD COLUMN IF NOT EXISTS mts_used_current_stroke BOOLEAN;

COMMENT ON COLUMN erp_production.process_order.mts_used_current_stroke IS
'MTS-only. true = Current Stroke was used at Create (Policy 1: skips QA approval, no Start Batch, finalize directly from STANDARD). false = a non-current stroke was used (Policy 2: classic Standard -> QA Approved -> Final -> Verify, no Start Batch step either). NULL for MTO/HPS/INT/MTEST.';

COMMIT;
