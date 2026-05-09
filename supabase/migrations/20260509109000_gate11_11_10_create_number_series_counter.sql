/*
 * File-ID: 11.10
 * File-Path: supabase/migrations/20260509109000_gate11_11_10_create_number_series_counter.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: Create number series counters and the generate_doc_number function.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.number_series_counter (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  series_id       uuid NOT NULL
    REFERENCES erp_inventory.number_series_master(id)
    ON DELETE RESTRICT,

  -- e.g. '2026-27' or '2026'
  financial_year  text NOT NULL,

  last_number     int NOT NULL DEFAULT 0,
  last_generated  timestamptz NULL,

  UNIQUE (series_id, financial_year)
);

COMMENT ON TABLE erp_inventory.number_series_counter IS
'Current counter per number series per financial year. Atomically incremented.';

-- Generator Function
-- Returns the next formatted document number for a given series.
-- Atomically increments the counter. Safe for concurrent calls.
CREATE OR REPLACE FUNCTION erp_inventory.generate_doc_number(
  p_company_id    uuid,
  p_section_id    uuid,
  p_document_type text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_series        erp_inventory.number_series_master%ROWTYPE;
  v_fy            text;
  v_fy_start      date;
  v_next_num      int;
  v_num_str       text;
  v_doc_number    text;
  v_today         date := current_date;
BEGIN
  -- 1. Find the active series
  SELECT * INTO v_series
  FROM erp_inventory.number_series_master
  WHERE company_id    = p_company_id
    AND (section_id   = p_section_id OR (section_id IS NULL AND p_section_id IS NULL))
    AND document_type = p_document_type
    AND active        = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NUMBER_SERIES_NOT_FOUND: No active series for company=%, section=%, type=%',
      p_company_id, p_section_id, p_document_type;
  END IF;

  -- 2. Determine current financial year string
  IF v_series.fy_start_month = 4 THEN
    -- April start: FY 2026-27
    IF EXTRACT(MONTH FROM v_today) >= 4 THEN
      v_fy := EXTRACT(YEAR FROM v_today)::text || '-' ||
              (EXTRACT(YEAR FROM v_today) + 1 - 2000)::text;
    ELSE
      v_fy := (EXTRACT(YEAR FROM v_today) - 1)::text || '-' ||
              (EXTRACT(YEAR FROM v_today) - 2000)::text;
    END IF;
  ELSE
    -- January start or other: just the year
    v_fy := EXTRACT(YEAR FROM v_today)::text;
  END IF;

  -- 3. Atomically increment counter (INSERT or UPDATE)
  INSERT INTO erp_inventory.number_series_counter (series_id, financial_year, last_number, last_generated)
  VALUES (v_series.id, v_fy, 1, now())
  ON CONFLICT (series_id, financial_year)
  DO UPDATE SET
    last_number    = erp_inventory.number_series_counter.last_number + 1,
    last_generated = now()
  RETURNING last_number INTO v_next_num;

  -- 4. Format the number with padding
  v_num_str := lpad(v_next_num::text, v_series.number_padding, '0');

  -- 5. Assemble the document number
  -- Pattern: {prefix}{separator}{num_str}{separator}{FY}
  -- e.g. AC/RP00001/2026-27 or GRN-00001
  v_doc_number := '';

  IF v_series.prefix <> '' THEN
    v_doc_number := v_series.prefix || v_series.separator;
  END IF;

  v_doc_number := v_doc_number || v_num_str;

  IF v_series.include_fy_in_number THEN
    v_doc_number := v_doc_number || v_series.separator || v_fy;
  END IF;

  IF v_series.suffix IS NOT NULL AND v_series.suffix <> '' THEN
    v_doc_number := v_doc_number || v_series.separator || v_series.suffix;
  END IF;

  RETURN v_doc_number;
END;
$$;

COMMIT;
