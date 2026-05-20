/*
 * File-ID: 18.1.3
 * File-Path: supabase/migrations/20260512100200_gate18_18_1_3_create_company_doc_number_functions.sql
 * Gate: 18
 * Phase: 18
 * Domain: PROCUREMENT
 * Purpose: Create company+FY document numbering and align global numbering behavior.
 * Authority: Backend
 */

BEGIN;

CREATE OR REPLACE FUNCTION erp_procurement.generate_doc_number(p_doc_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row erp_procurement.document_number_series%ROWTYPE;
BEGIN
  UPDATE erp_procurement.document_number_series
  SET last_number = CASE
    WHEN last_number = 0 THEN starting_number
    ELSE last_number + 1
  END
  WHERE doc_type = p_doc_type
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_DOC_TYPE: %', p_doc_type;
  END IF;

  RETURN lpad(v_row.last_number::text, v_row.pad_width, '0');
END;
$$;

CREATE OR REPLACE FUNCTION erp_procurement.generate_company_doc_number(
  p_company_id uuid,
  p_doc_type text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_series erp_procurement.company_doc_number_series%ROWTYPE;
  v_fy text;
  v_month int;
  v_year int;
  v_next bigint;
  v_padded text;
BEGIN
  SELECT * INTO v_series
  FROM erp_procurement.company_doc_number_series
  WHERE company_id = p_company_id
    AND document_type = p_doc_type
    AND active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_DOC_SERIES_NOT_FOUND: company=%, doc_type=%', p_company_id, p_doc_type;
  END IF;

  v_month := EXTRACT(MONTH FROM current_date);
  v_year := EXTRACT(YEAR FROM current_date);

  IF v_month >= 4 THEN
    v_fy := LPAD((v_year - 2000)::text, 2, '0') || '-' ||
            LPAD((v_year - 1999)::text, 2, '0');
  ELSE
    v_fy := LPAD((v_year - 2001)::text, 2, '0') || '-' ||
            LPAD((v_year - 2000)::text, 2, '0');
  END IF;

  INSERT INTO erp_procurement.company_doc_number_counter (
    company_id,
    document_type,
    financial_year,
    starting_number,
    last_number
  )
  VALUES (
    p_company_id,
    p_doc_type,
    v_fy,
    1,
    0
  )
  ON CONFLICT (company_id, document_type, financial_year) DO NOTHING;

  UPDATE erp_procurement.company_doc_number_counter
  SET last_number = CASE
    WHEN last_number = 0 THEN starting_number
    ELSE last_number + 1
  END
  WHERE company_id = p_company_id
    AND document_type = p_doc_type
    AND financial_year = v_fy
  RETURNING last_number INTO v_next;

  v_padded := LPAD(v_next::text, v_series.number_padding, '0');
  RETURN v_series.prefix || '/' || v_fy || '/' || v_padded;
END;
$$;

REVOKE EXECUTE ON FUNCTION erp_procurement.generate_company_doc_number(uuid, text)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement.generate_company_doc_number(uuid, text)
  TO service_role;

DROP FUNCTION IF EXISTS erp_procurement.generate_invoice_number();

COMMIT;
