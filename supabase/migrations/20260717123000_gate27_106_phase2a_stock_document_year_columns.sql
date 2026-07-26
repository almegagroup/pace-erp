/*
 * File-Path: supabase/migrations/20260717123000_gate27_106_phase2a_stock_document_year_columns.sql
 * Gate: 27.106
 * Domain: INVENTORY / STOCK ENGINE
 * Purpose: Section 106 Phase 2, Step A (schema, NON-BREAKING) — add the SAP MJAHR-style
 *   fiscal-year fields to erp_inventory.stock_document so a Material Document is identified
 *   by (document_number, document_year) — MBLNR + MJAHR — and widen the item uniqueness key
 *   to include the year.
 *
 *   Non-breaking by construction:
 *     - document_year defaults to '' (empty sentinel), so every existing row and every
 *       not-yet-migrated caller keeps the exact behaviour of §105 (business number in
 *       document_number, item_number scoped per document_number). '' is NOT NULL, so it
 *       participates correctly in the widened unique key.
 *     - post_stock_movement() is NOT touched here (that is Step B). Until a caller starts
 *       passing a real MatDoc number+year, everything writes document_year='' and behaves
 *       identically to before.
 * Authority: Backend / DB
 */

-- 1. MJAHR-style fiscal-year fields (MBLNR+MJAHR two-part key; '' sentinel = legacy/pre-MatDoc)
ALTER TABLE erp_inventory.stock_document
  ADD COLUMN IF NOT EXISTS document_year text NOT NULL DEFAULT '';

-- Reversal pointer's year companion (SAP SMBLN + SJAHR). Nullable — only set on reversals.
ALTER TABLE erp_inventory.stock_document
  ADD COLUMN IF NOT EXISTS reversal_document_year text;

-- 2. Widen the item uniqueness key to include the year, so a MatDoc number that recurs in a
--    later FY (year-scoped counter resets) never collides with the same number in a prior FY.
--    Existing rows (document_year='') are unaffected: (business_number, '', item_number) stays
--    unique exactly as (business_number, item_number) was.
ALTER TABLE erp_inventory.stock_document
  DROP CONSTRAINT IF EXISTS stock_document_document_number_item_number_key;

ALTER TABLE erp_inventory.stock_document
  ADD CONSTRAINT stock_document_docnum_docyear_item_key
  UNIQUE (document_number, document_year, item_number);
