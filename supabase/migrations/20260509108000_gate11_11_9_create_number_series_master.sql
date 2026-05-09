/*
 * File-ID: 11.9
 * File-Path: supabase/migrations/20260509108000_gate11_11_9_create_number_series_master.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: Create the number_series_master table for SA-configurable document series.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.number_series_master (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References erp_master.companies
  company_id            uuid NOT NULL,

  -- Optional: for section-specific series (e.g. Admix vs Powder PO)
  -- References erp_master.projects or a future section master
  section_id            uuid NULL,

  -- What document type does this series generate numbers for?
  -- e.g. PO, GRN, GATE_ENTRY, PROCESS_ORDER, PACKING_ORDER,
  --      DISPATCH_INSTRUCTION, PLANT_TRANSFER, PID, OPENING_STOCK
  document_type         text NOT NULL,

  -- Number format components
  prefix                text NOT NULL DEFAULT '',
  suffix                text NULL,
  separator             text NOT NULL DEFAULT '/',
  -- How many digits in the number part? e.g. 5 -> 00001
  number_padding        int NOT NULL DEFAULT 5,

  -- Does the counter reset on financial year change?
  financial_year_reset  boolean NOT NULL DEFAULT true,

  -- Which month does the financial year start? 4 = April, 1 = January
  fy_start_month        int NOT NULL DEFAULT 4
    CHECK (fy_start_month BETWEEN 1 AND 12),

  -- Include FY in the generated number? e.g. AC/RP00001/2026-27
  include_fy_in_number  boolean NOT NULL DEFAULT true,

  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NULL,

  UNIQUE (company_id, section_id, document_type)
);

COMMENT ON TABLE erp_inventory.number_series_master IS
'SA-configurable document number series. One series per company+section+document_type. Nothing hardcoded.';

COMMIT;
