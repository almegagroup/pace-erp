/*
 * File-Path: supabase/migrations/20260717141000_gate27_106_phase3_generic_year_scoped_doc_number.sql
 * Gate: 27.106
 * Domain: INVENTORY / STOCK ENGINE + RECO-COSTING
 * Purpose: Section 106 Phase 3 — generalise the year-scoped (number + fiscal-year) generator
 *   so every Layer-2/Layer-3 document type can share ONE implementation of the FY logic.
 *
 *   erp_inventory.generate_year_scoped_doc_number(company, document_type) returns
 *   (doc_number, doc_year) for any document_type configured in number_series_master with
 *   financial_year_reset = true (MATDOC = Material Document / MBLNR+MJAHR,
 *   RECO = Costing document / BELNR+GJAHR, and future FI/Invoice types).
 *
 *   generate_material_doc_number(company) is kept as-is for its 11 existing callers, but its
 *   body now delegates to the generic function — so the FY calculation exists in exactly one
 *   place and cannot drift between document types.
 * Authority: Backend / DB
 */

CREATE OR REPLACE FUNCTION erp_inventory.generate_year_scoped_doc_number(
  p_company_id uuid,
  p_document_type text
)
RETURNS TABLE (doc_number text, doc_year text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_series   erp_inventory.number_series_master%ROWTYPE;
  v_fy       text;
  v_next_num int;
  v_today    date := current_date;
BEGIN
  SELECT * INTO v_series
  FROM erp_inventory.number_series_master
  WHERE company_id    = p_company_id
    AND section_id IS NULL
    AND document_type = p_document_type
    AND active        = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NUMBER_SERIES_NOT_FOUND: no active % series for company=%',
      p_document_type, p_company_id;
  END IF;

  -- Fiscal year string (April-start when fy_start_month = 4), e.g. '2026-27'
  IF v_series.fy_start_month = 4 THEN
    IF EXTRACT(MONTH FROM v_today) >= 4 THEN
      v_fy := EXTRACT(YEAR FROM v_today)::text || '-' ||
              (EXTRACT(YEAR FROM v_today) + 1 - 2000)::text;
    ELSE
      v_fy := (EXTRACT(YEAR FROM v_today) - 1)::text || '-' ||
              (EXTRACT(YEAR FROM v_today) - 2000)::text;
    END IF;
  ELSE
    v_fy := EXTRACT(YEAR FROM v_today)::text;
  END IF;

  -- Atomic per-(series, FY) increment — resets automatically each FY because the counter
  -- row is keyed by financial_year. Race-safe (single UPDATE ... RETURNING).
  INSERT INTO erp_inventory.number_series_counter (series_id, financial_year, last_number, last_generated)
  VALUES (v_series.id, v_fy, 1, now())
  ON CONFLICT (series_id, financial_year)
  DO UPDATE SET
    last_number    = erp_inventory.number_series_counter.last_number + 1,
    last_generated = now()
  RETURNING last_number INTO v_next_num;

  doc_number := lpad(v_next_num::text, v_series.number_padding, '0');
  doc_year   := v_fy;
  RETURN NEXT;
END;
$function$;

-- Material Document generator now delegates — single source of truth for the FY logic.
CREATE OR REPLACE FUNCTION erp_inventory.generate_material_doc_number(p_company_id uuid)
RETURNS TABLE (doc_number text, doc_year text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT doc_number, doc_year
  FROM erp_inventory.generate_year_scoped_doc_number(p_company_id, 'MATDOC');
$function$;
