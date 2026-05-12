/*
 * File-ID: 13.1.5
 * File-Path: supabase/migrations/20260511014000_gate13_1_13_1_5_create_lead_time_masters.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Lead Time Master Import (sail time + clearance) and Domestic (transit days) for ETA cascade.
 * Authority: Backend
 */

BEGIN;

-- Import Lead Time Master
-- Provides: Sail Time (BV) and Clearance Days (BQ) for import ETA cascade.
-- Lookup key: vendor + material category + port of discharge
CREATE TABLE IF NOT EXISTS erp_master.lead_time_master_import (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  vendor_id               uuid NOT NULL
    REFERENCES erp_master.vendor_master(id)
    ON DELETE RESTRICT,

  material_category_id    uuid NOT NULL
    REFERENCES erp_master.material_category_master(id)
    ON DELETE RESTRICT,

  -- Vendor's dispatch port - free text (may not be in our port master)
  port_of_loading         text NOT NULL,

  -- India destination port - must be in port master
  port_of_discharge_id    uuid NOT NULL
    REFERENCES erp_master.port_master(id)
    ON DELETE RESTRICT,

  -- BV: vessel transit days (loading port to discharge port)
  sail_time_days          int NOT NULL CHECK (sail_time_days >= 0),

  -- BQ: expected customs clearance days at discharge port
  clearance_days          int NOT NULL CHECK (clearance_days >= 0),

  -- Version control
  effective_from          date NOT NULL,
  effective_to            date NULL, -- NULL = currently active

  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL
);

COMMENT ON TABLE erp_master.lead_time_master_import IS
'Import lead times per vendor + material category + port of discharge. Provides Sail Time (BV) and Clearance Days (BQ) for ETA cascade calculation. SA-managed. Use effective_from/to for version control.';

-- Domestic Lead Time Master
-- Provides: Transit Days for domestic ETA cascade.
-- Lookup key: vendor + destination company
CREATE TABLE IF NOT EXISTS erp_master.lead_time_master_domestic (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  vendor_id               uuid NOT NULL
    REFERENCES erp_master.vendor_master(id)
    ON DELETE RESTRICT,

  company_id              uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,

  -- Days from LR Date to plant gate arrival
  transit_days            int NOT NULL CHECK (transit_days >= 0),

  effective_from          date NOT NULL,
  effective_to            date NULL,

  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL
);

COMMENT ON TABLE erp_master.lead_time_master_domestic IS
'Domestic lead times per vendor + destination company. Provides Transit Days for domestic ETA cascade. ETA = LR Date + transit_days (or PO Date + transit_days when LR not yet entered). SA-managed.';

CREATE INDEX IF NOT EXISTS idx_ltmi_vendor_cat  ON erp_master.lead_time_master_import (vendor_id, material_category_id);
CREATE INDEX IF NOT EXISTS idx_ltmi_discharge   ON erp_master.lead_time_master_import (port_of_discharge_id);
CREATE INDEX IF NOT EXISTS idx_ltmi_active      ON erp_master.lead_time_master_import (active);
CREATE INDEX IF NOT EXISTS idx_ltmd_vendor_co   ON erp_master.lead_time_master_domestic (vendor_id, company_id);
CREATE INDEX IF NOT EXISTS idx_ltmd_active      ON erp_master.lead_time_master_domestic (active);

GRANT SELECT ON erp_master.lead_time_master_import    TO authenticated;
GRANT SELECT ON erp_master.lead_time_master_domestic  TO authenticated;
GRANT ALL    ON erp_master.lead_time_master_import    TO service_role;
GRANT ALL    ON erp_master.lead_time_master_domestic  TO service_role;

COMMIT;
