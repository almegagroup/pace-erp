/*
 * File-Path: supabase/migrations/20260717120000_gate27_106_material_document_number_generator.sql
 * Gate: 27.106
 * Domain: INVENTORY / STOCK ENGINE
 * Purpose: Section 106 — SAP Material Document (MBLNR + MJAHR) number generator.
 *   Returns the material-document number AND its fiscal year as SEPARATE values,
 *   mirroring SAP's MBLNR (document number) / MJAHR (year) two-field key. Reuses the
 *   already-built, atomic, FY-aware number_series_master / number_series_counter engine
 *   (erp_inventory.generate_doc_number's mechanism) via a company-scoped 'MATDOC' series.
 *
 *   This is Phase 1 (foundation) of the §106 rollout: purely additive, non-breaking —
 *   post_stock_movement() and its callers are NOT touched here. See feasibility doc
 *   Section 106 for the full staged plan.
 * Authority: Backend / DB
 */

CREATE OR REPLACE FUNCTION erp_inventory.generate_material_doc_number(p_company_id uuid)
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
  -- 1. Active company-scoped MATDOC series (section-agnostic)
  SELECT * INTO v_series
  FROM erp_inventory.number_series_master
  WHERE company_id    = p_company_id
    AND section_id IS NULL
    AND document_type = 'MATDOC'
    AND active        = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATDOC_SERIES_NOT_FOUND: no active MATDOC series for company=%', p_company_id;
  END IF;

  -- 2. Fiscal year string (April-start when fy_start_month = 4), e.g. '2026-27'
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

  -- 3. Atomic per-(series, FY) increment — resets automatically each FY because the
  --    counter row is keyed by financial_year. Race-safe (single UPDATE...RETURNING).
  INSERT INTO erp_inventory.number_series_counter (series_id, financial_year, last_number, last_generated)
  VALUES (v_series.id, v_fy, 1, now())
  ON CONFLICT (series_id, financial_year)
  DO UPDATE SET
    last_number    = erp_inventory.number_series_counter.last_number + 1,
    last_generated = now()
  RETURNING last_number INTO v_next_num;

  -- 4. Return number + year as the two-part MBLNR/MJAHR key
  doc_number := lpad(v_next_num::text, v_series.number_padding, '0');
  doc_year   := v_fy;
  RETURN NEXT;
END;
$function$;
