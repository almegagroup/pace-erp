/*
 * File-ID: 13.1.3
 * File-Path: supabase/migrations/20260511012000_gate13_1_13_1_3_create_port_plant_transit_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Port-to-Plant transit days per port + destination company combination for import ETA cascade.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.port_plant_transit_master (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK - port_master is in erp_master
  port_id         uuid NOT NULL
    REFERENCES erp_master.port_master(id)
    ON DELETE RESTRICT,

  -- Intra-schema FK - companies is in erp_master
  company_id      uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,

  -- BR - days from port gate-out to plant gate arrival
  transit_days    int NOT NULL CHECK (transit_days >= 0),

  -- ROAD | RAIL | MULTI-MODAL
  mode            text NOT NULL DEFAULT 'ROAD'
    CHECK (mode IN ('ROAD', 'RAIL', 'MULTI-MODAL')),

  remarks         text NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL,

  -- One transit record per port + company combination
  UNIQUE (port_id, company_id)
);

COMMENT ON TABLE erp_master.port_plant_transit_master IS
'Transit days from discharge port to destination company. One record per port + company pair. Same port, same company always has same transit days regardless of material. SA-managed.';

CREATE INDEX IF NOT EXISTS idx_pptm_port    ON erp_master.port_plant_transit_master (port_id);
CREATE INDEX IF NOT EXISTS idx_pptm_company ON erp_master.port_plant_transit_master (company_id);

GRANT SELECT ON erp_master.port_plant_transit_master TO authenticated;
GRANT ALL    ON erp_master.port_plant_transit_master TO service_role;

COMMIT;
