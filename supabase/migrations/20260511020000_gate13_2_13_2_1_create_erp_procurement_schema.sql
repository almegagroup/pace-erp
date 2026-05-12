/*
 * File-ID: 13.2.1
 * File-Path: supabase/migrations/20260511020000_gate13_2_13_2_1_create_erp_procurement_schema.sql
 * Gate: 13.2
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Create erp_procurement schema and grant access.
 * Authority: Backend
 */

BEGIN;

CREATE SCHEMA IF NOT EXISTS erp_procurement;

GRANT USAGE ON SCHEMA erp_procurement TO authenticated;
GRANT USAGE ON SCHEMA erp_procurement TO service_role;
GRANT ALL   ON ALL TABLES IN SCHEMA erp_procurement TO service_role;
GRANT ALL   ON ALL SEQUENCES IN SCHEMA erp_procurement TO service_role;

-- Global document number series for erp_procurement
-- One counter per document type. All are global (no company/FY scope).
CREATE TABLE IF NOT EXISTS erp_procurement.document_number_series (
  doc_type      text PRIMARY KEY,
  last_number   bigint NOT NULL DEFAULT 0,
  -- Width of the zero-padded number string
  pad_width     int NOT NULL DEFAULT 6
);

-- Seed all document types for erp_procurement
INSERT INTO erp_procurement.document_number_series (doc_type, pad_width) VALUES
  ('CSN',      6),  -- Consignment Note:      000001
  ('GE',       6),  -- Gate Entry:             000001
  ('GEX',      6),  -- Gate Exit (inbound):    000001
  ('GXO',      6),  -- Gate Exit (outbound):   000001
  ('GRN',      6),  -- Goods Receipt Note:     000001
  ('QA',       6),  -- QA Document:            000001
  ('STO',      6),  -- Stock Transfer Order:   000001
  ('DC',       6),  -- Delivery Challan:       000001
  ('RTV',      6),  -- Return to Vendor:       000001
  ('DN',       6),  -- Debit Note:             000001
  ('EXR',      6),  -- Exchange Reference:     000001
  ('IV',       6),  -- Invoice Verification:   000001
  ('LC',       6),  -- Landed Cost:            000001
  ('SO',       6)   -- Sales Order:            000001
ON CONFLICT (doc_type) DO NOTHING;

-- Invoice number series (special format: YYYYMM + incremental - Section 99.3)
CREATE TABLE IF NOT EXISTS erp_procurement.invoice_number_series (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_number bigint NOT NULL DEFAULT 0
);
INSERT INTO erp_procurement.invoice_number_series (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

-- Function: generate next document number (global, pure numeric)
CREATE OR REPLACE FUNCTION erp_procurement.generate_doc_number(p_doc_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row erp_procurement.document_number_series%ROWTYPE;
BEGIN
  UPDATE erp_procurement.document_number_series
  SET last_number = last_number + 1
  WHERE doc_type = p_doc_type
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_DOC_TYPE: %', p_doc_type;
  END IF;

  RETURN lpad(v_row.last_number::text, v_row.pad_width, '0');
END;
$$;

-- Function: generate invoice number (YYYYMM + incremental - never resets)
CREATE OR REPLACE FUNCTION erp_procurement.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next  bigint;
  v_yyyymm text;
BEGIN
  UPDATE erp_procurement.invoice_number_series
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;

  v_yyyymm := to_char(now(), 'YYYYMM');
  RETURN v_yyyymm || lpad(v_next::text, 6, '0');
END;
$$;

COMMIT;
