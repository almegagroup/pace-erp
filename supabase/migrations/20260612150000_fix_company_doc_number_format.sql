/*
 * File-Path: supabase/migrations/20260612150000_fix_company_doc_number_format.sql
 * Purpose: Change company document number format from PREFIX/26-27/0001 to PREFIX2627-0001
 */

BEGIN;

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
  v_fy      text;
  v_fy_compact text;
  v_month   int;
  v_year    int;
  v_next    bigint;
  v_padded  text;
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

  -- Determine current financial year (April start)
  v_month := EXTRACT(MONTH FROM current_date);
  v_year  := EXTRACT(YEAR FROM current_date);

  IF v_month >= 4 THEN
    v_fy := LPAD((v_year - 2000)::text, 2, '0') || '-' ||
            LPAD((v_year - 1999)::text, 2, '0');
  ELSE
    v_fy := LPAD((v_year - 2001)::text, 2, '0') || '-' ||
            LPAD((v_year - 2000)::text, 2, '0');
  END IF;

  -- Compact FY: "26-27" → "2627"
  v_fy_compact := replace(v_fy, '-', '');

  -- Create counter for this FY if not exists (starting_number=1 default)
  -- If user pre-created the counter with a custom starting_number, ON CONFLICT DO NOTHING preserves it
  INSERT INTO erp_procurement.company_doc_number_counter (
    company_id, document_type, financial_year, starting_number, last_number
  )
  VALUES (p_company_id, p_doc_type, v_fy, 1, 0)
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

  -- Format: {prefix}{compact_fy}-{padded_number}  e.g. ASCPO2627-0001
  RETURN v_series.prefix || v_fy_compact || '-' || v_padded;
END;
$$;

REVOKE EXECUTE ON FUNCTION erp_procurement.generate_company_doc_number(uuid, text)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement.generate_company_doc_number(uuid, text)
  TO service_role;

COMMIT;
