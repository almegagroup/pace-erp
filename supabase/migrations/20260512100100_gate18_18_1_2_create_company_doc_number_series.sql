/*
 * File-ID: 18.1.2
 * File-Path: supabase/migrations/20260512100100_gate18_18_1_2_create_company_doc_number_series.sql
 * Gate: 18
 * Phase: 18
 * Domain: PROCUREMENT
 * Purpose: Create company + FY scoped number series configuration tables for PO and STO.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.company_doc_number_series (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  document_type    text NOT NULL,
  prefix           text NOT NULL,
  number_padding   int NOT NULL DEFAULT 5,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NULL,

  UNIQUE (company_id, document_type)
);

COMMENT ON TABLE erp_procurement.company_doc_number_series IS
'SA-configurable prefix per company+document_type. Used for PO and STO.';

CREATE TABLE IF NOT EXISTS erp_procurement.company_doc_number_counter (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  document_type    text NOT NULL,
  financial_year   text NOT NULL,
  starting_number  bigint NOT NULL DEFAULT 1,
  last_number      bigint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NULL,

  UNIQUE (company_id, document_type, financial_year)
);

COMMENT ON TABLE erp_procurement.company_doc_number_counter IS
'Counter per company+doc_type+FY. SA sets starting_number. System increments last_number.';

GRANT ALL ON erp_procurement.company_doc_number_series TO service_role;
GRANT ALL ON erp_procurement.company_doc_number_counter TO service_role;

COMMIT;
