/*
 * File-Path: supabase/migrations/20260915150000_batch_series_auto_generate.sql
 * Domain: PRODUCTION
 * Purpose: Per-series flag distinguishing auto-generated batch numbers
 *          (existing generate_batch_series_number()/current_count mechanism,
 *          unchanged) from manual-entry-only series -- an MTS-only choice,
 *          since MTO/HPS/MTEST always auto-generate by design (company-level,
 *          no per-Prodshade choice). Defaults TRUE so every existing row
 *          (all batch types, MTS included) keeps behaving exactly as it does
 *          today -- SA opts a Prodshade into manual-entry by unchecking it.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_production.batch_number_series
  ADD COLUMN IF NOT EXISTS auto_generate BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN erp_production.batch_number_series.auto_generate IS
'When true (default, all existing rows), Start Batch auto-generates the next number via generate_batch_series_number()/current_count, unchanged. When false (MTS-only choice, SA Batch Series checkbox), the series is manual-entry-only -- Start Batch does not auto-generate for it.';

COMMIT;
