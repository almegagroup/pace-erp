ALTER TABLE erp_production.batch_number_series
  ADD COLUMN numbering_method TEXT NOT NULL DEFAULT 'PLAIN'
    CHECK (numbering_method IN ('PLAIN', 'CONTINUOUS_DATE', 'MONTHLY_RESET_MONYY')),
  ADD COLUMN serial_pad_width INTEGER NOT NULL DEFAULT 5
    CHECK (serial_pad_width BETWEEN 1 AND 10),
  ADD COLUMN reset_period TEXT NULL;

CREATE OR REPLACE FUNCTION erp_production.generate_batch_series_number(
  p_company_id UUID,
  p_batch_type TEXT,
  p_prodshade_material_id UUID DEFAULT NULL,
  p_today DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  batch_number TEXT,
  current_count INTEGER,
  prefix TEXT,
  numbering_method TEXT,
  serial_pad_width INTEGER,
  reset_period TEXT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = erp_production, public
AS $$
  WITH updated AS (
    UPDATE erp_production.batch_number_series AS s
    SET
      current_count = CASE
        WHEN s.numbering_method = 'MONTHLY_RESET_MONYY'
          AND COALESCE(s.reset_period, '') <> TO_CHAR(p_today, 'MMYY')
          THEN 1
        WHEN s.current_count >= LEAST((POWER(10::numeric, s.serial_pad_width) - 1), 2147483647)::INTEGER
          THEN 1
        ELSE s.current_count + 1
      END,
      reset_period = CASE
        WHEN s.numbering_method = 'MONTHLY_RESET_MONYY' THEN TO_CHAR(p_today, 'MMYY')
        ELSE s.reset_period
      END,
      last_updated_at = NOW()
    WHERE s.company_id = p_company_id
      AND s.batch_type = p_batch_type
      AND s.active = TRUE
      AND (
        (p_prodshade_material_id IS NULL AND s.prodshade_material_id IS NULL)
        OR s.prodshade_material_id = p_prodshade_material_id
      )
    RETURNING
      s.prefix,
      s.current_count,
      s.numbering_method,
      s.serial_pad_width,
      s.reset_period
  )
  SELECT
    CASE updated.numbering_method
      WHEN 'CONTINUOUS_DATE'
        THEN updated.prefix || TO_CHAR(p_today, 'DD-MM-YYYY') || '/' || LPAD(updated.current_count::TEXT, updated.serial_pad_width, '0')
      WHEN 'MONTHLY_RESET_MONYY'
        THEN updated.prefix || TO_CHAR(p_today, 'MMYY') || '/' || LPAD(updated.current_count::TEXT, updated.serial_pad_width, '0')
      ELSE
        updated.prefix || LPAD(updated.current_count::TEXT, updated.serial_pad_width, '0')
    END AS batch_number,
    updated.current_count,
    updated.prefix,
    updated.numbering_method,
    updated.serial_pad_width,
    updated.reset_period
  FROM updated;
$$;
