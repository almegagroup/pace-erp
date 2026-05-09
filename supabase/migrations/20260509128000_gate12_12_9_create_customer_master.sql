/*
 * File-ID: 12.9
 * File-Path: supabase/migrations/20260509128000_gate12_12_9_create_customer_master.sql
 * Gate: 12
 * Phase: 12
 * Domain: MASTER
 * Purpose: Create the customer master and customer-company mapping tables for Phase-1 dispatch recipients.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.customer_master (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated. Format: C-00001
  customer_code           text NOT NULL UNIQUE,

  customer_name           text NOT NULL,

  -- DOMESTIC | EXPORT
  customer_type           text NOT NULL
    CHECK (customer_type IN ('DOMESTIC', 'EXPORT')),

  -- Address
  delivery_address        text NOT NULL,
  billing_address         text NULL,

  -- GST / Tax
  gst_number              text NULL,
  pan_number              text NULL,

  -- Contact
  primary_contact_person  text NULL,
  phone                   text NULL,
  primary_email           text NULL,

  -- Currency
  currency_code           text NOT NULL DEFAULT 'BDT',

  -- Status
  -- DRAFT -> PENDING_APPROVAL -> ACTIVE -> INACTIVE | BLOCKED
  status                  text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'BLOCKED')),

  -- Audit
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL,
  approved_by             uuid NULL,
  approved_at             timestamptz NULL
);

COMMENT ON TABLE erp_master.customer_master IS
'Customer identity record. Basic Phase-1 fields. Credit limit, pricing, and advanced SD features are Phase-2.';

CREATE INDEX IF NOT EXISTS idx_cm_customer_code ON erp_master.customer_master (customer_code);
CREATE INDEX IF NOT EXISTS idx_cm_status ON erp_master.customer_master (status);

-- Customer Company Map
CREATE TABLE IF NOT EXISTS erp_master.customer_company_map (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL
    REFERENCES erp_master.customer_master(id)
    ON DELETE RESTRICT,
  company_id  uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, company_id)
);

COMMIT;
