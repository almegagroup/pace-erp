/*
 * File-ID: 12B.1
 * File-Path: supabase/migrations/20260509200000_gate12b_cost_center_master.sql
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: Cost center master table for SA-governed cost attribution.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.cost_center_master (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  cost_center_code    text NOT NULL,
  cost_center_name    text NOT NULL,
  description         text NULL,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL,

  UNIQUE (company_id, cost_center_code)
);

CREATE INDEX IF NOT EXISTS idx_ccm_company ON erp_master.cost_center_master (company_id);
CREATE INDEX IF NOT EXISTS idx_ccm_active  ON erp_master.cost_center_master (active);

COMMENT ON TABLE erp_master.cost_center_master IS
'SA-owned cost centers. Company-scoped. Used by process orders and stock documents for cost attribution.';

GRANT SELECT, INSERT, UPDATE ON erp_master.cost_center_master TO service_role;

COMMIT;
