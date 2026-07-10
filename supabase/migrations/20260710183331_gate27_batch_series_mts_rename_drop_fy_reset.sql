/*
 * Migration: gate27_batch_series_mts_rename_drop_fy_reset
 * Gate: 27.7 | Section 83.7 correction (LOCKED 2026-07-11, business owner override)
 * Purpose:
 *   1. IWC batch_type renamed to MTS — IWC + Powder now share one per-Prodshade
 *      series (Powder no longer gets manual-entry-only batch numbers).
 *   2. HPS moves from per-Prodshade to company-level (grouped with MTO/MTEST —
 *      none of these three are prodshade-scoped).
 *   3. fy_reset dropped entirely — batch numbers do NOT reset by financial
 *      year. They wrap 99999 -> 1 on overflow (handled in application code).
 * No existing rows in batch_number_series (verified via execute_sql) — no
 * data backfill needed for the IWC->MTS rename.
 */

BEGIN;

ALTER TABLE erp_production.batch_number_series
  DROP CONSTRAINT batch_number_series_batch_type_check;

ALTER TABLE erp_production.batch_number_series
  ADD CONSTRAINT batch_number_series_batch_type_check
  CHECK (batch_type = ANY (ARRAY['MTO'::text, 'HPS'::text, 'MTS'::text, 'MTEST'::text]));

ALTER TABLE erp_production.batch_number_series
  DROP COLUMN fy_reset;

COMMIT;
