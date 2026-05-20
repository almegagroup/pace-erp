/*
 * File-ID: 13.1.1
 * File-Path: supabase/migrations/20260511010000_gate13_1_13_1_1_create_payment_terms_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Payment Terms Master - structured terms referenced by PO, vendor, and customer.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.payment_terms_master (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated: PT-001, PT-002 etc.
  code              text NOT NULL UNIQUE,
  name              text NOT NULL,

  -- CREDIT | ADVANCE | LC | TT | DA | DP | MIXED
  payment_method    text NOT NULL
    CHECK (payment_method IN ('CREDIT', 'ADVANCE', 'LC', 'TT', 'DA', 'DP', 'MIXED')),

  -- INVOICE_DATE | GRN_DATE | BL_DATE | SHIPMENT_DATE | N_A
  reference_date    text NOT NULL DEFAULT 'INVOICE_DATE'
    CHECK (reference_date IN ('INVOICE_DATE', 'GRN_DATE', 'BL_DATE', 'SHIPMENT_DATE', 'N_A')),

  -- For CREDIT / MIXED terms
  credit_days       int NULL CHECK (credit_days >= 0),

  -- For ADVANCE / MIXED terms (0-100)
  advance_pct       numeric(5, 2) NULL CHECK (advance_pct >= 0 AND advance_pct <= 100),

  -- AT_SIGHT | USANCE | N_A
  lc_type           text NOT NULL DEFAULT 'N_A'
    CHECK (lc_type IN ('AT_SIGHT', 'USANCE', 'N_A')),

  -- For USANCE LC
  usance_days       int NULL CHECK (usance_days >= 0),

  description       text NULL,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  last_updated_at   timestamptz NULL,
  last_updated_by   uuid NULL
);

COMMENT ON TABLE erp_master.payment_terms_master IS
'Structured Payment Terms Master. Managed by Procurement Manager (no SA required). Referenced by PO header and Customer Master via dynamic last-used pattern. LC Required auto-derives when payment_method = LC.';

-- Code sequence for PT-001, PT-002...
CREATE TABLE IF NOT EXISTS erp_master.payment_terms_code_sequence (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_number int NOT NULL DEFAULT 0
);
INSERT INTO erp_master.payment_terms_code_sequence (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION erp_master.generate_payment_terms_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.payment_terms_code_sequence
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'PT-' || lpad(v_next::text, 3, '0');
END;
$$;

CREATE INDEX IF NOT EXISTS idx_ptm_code   ON erp_master.payment_terms_master (code);
CREATE INDEX IF NOT EXISTS idx_ptm_method ON erp_master.payment_terms_master (payment_method);
CREATE INDEX IF NOT EXISTS idx_ptm_active ON erp_master.payment_terms_master (active);

GRANT SELECT ON erp_master.payment_terms_master          TO authenticated;
GRANT ALL    ON erp_master.payment_terms_master          TO service_role;
GRANT ALL    ON erp_master.payment_terms_code_sequence   TO service_role;

COMMIT;
