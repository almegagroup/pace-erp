-- File-Path: supabase/migrations/20260928060000_inward_qa_test_line_skip_flag.sql
-- Purpose: Inward QA — per-method "Skip" flag on erp_procurement.inward_qa_test_line.
--   Business owner (2026-09-28): a mandatory (MCT) test method can be skipped at the
--   moment of decision entry (e.g. lab result not back yet). Skipping a method excludes
--   it from the "all mandatory MCT results must be filled" gate so the usage decision can
--   still be submitted; the skipped-but-unfilled method stays visible afterwards so the
--   user can return, uncheck Skip, and fill in the real result once it's available.
-- Authority: Backend (Gate: Inward QA / PROC_QA_QUEUE)

ALTER TABLE erp_procurement.inward_qa_test_line
  ADD COLUMN IF NOT EXISTS is_skipped boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_procurement.inward_qa_test_line.is_skipped IS
  'True when the user explicitly skipped this method at decision time (bypasses the mandatory-MCT-filled gate). Result stays editable later; unchecking clears this flag.';
