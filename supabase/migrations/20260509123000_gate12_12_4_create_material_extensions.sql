/*
 * File-ID: 12.4
 * File-Path: supabase/migrations/20260509123000_gate12_12_4_create_material_extensions.sql
 * Gate: 12
 * Phase: 12
 * Domain: MASTER
 * Purpose: Create material company and plant extension tables for scoped usage control.
 * Authority: Backend
 */

BEGIN;

-- Company Extension
CREATE TABLE IF NOT EXISTS erp_master.material_company_ext (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  material_id                 uuid NOT NULL
    REFERENCES erp_master.material_master(id)
    ON DELETE RESTRICT,

  company_id                  uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,

  procurement_allowed         boolean NOT NULL DEFAULT true,

  -- Company-specific overrides (NULL = use material master default)
  valuation_method_override   text NULL
    CHECK (valuation_method_override IN ('WEIGHTED_AVERAGE', 'DIRECT_BATCH_COST')),

  hsn_code_override           text NULL,

  -- ACTIVE | INACTIVE
  status                      text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),

  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL,
  approved_by                 uuid NULL,
  approved_at                 timestamptz NULL,

  UNIQUE (material_id, company_id)
);

COMMENT ON TABLE erp_master.material_company_ext IS
'Material must be extended to a company before any company-level transaction. Controls procurement permission per company.';

-- Plant Extension
CREATE TABLE IF NOT EXISTS erp_master.material_plant_ext (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  material_id                     uuid NOT NULL
    REFERENCES erp_master.material_master(id)
    ON DELETE RESTRICT,

  company_id                      uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,

  -- plant = project in PACE
  plant_id                        uuid NOT NULL
    REFERENCES erp_master.projects(id)
    ON DELETE RESTRICT,

  -- Where does GRN land by default for this material at this plant?
  -- References erp_inventory.storage_location_master(id) - no FK to avoid cross-schema constraint
  default_storage_location_id     uuid NULL,

  -- Plant-specific QA override (NULL = use material master setting)
  qa_required_on_inward_override  boolean NULL,

  -- Planning fields
  safety_stock_qty                numeric(20, 6) NULL CHECK (safety_stock_qty >= 0),
  reorder_point_qty               numeric(20, 6) NULL CHECK (reorder_point_qty >= 0),
  min_order_qty                   numeric(20, 6) NULL CHECK (min_order_qty > 0),
  lead_time_days                  int NULL CHECK (lead_time_days >= 0),

  -- ACTIVE | INACTIVE
  status                          text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),

  created_at                      timestamptz NOT NULL DEFAULT now(),
  created_by                      uuid NOT NULL,
  approved_by                     uuid NULL,
  approved_at                     timestamptz NULL,

  UNIQUE (material_id, company_id, plant_id)
);

COMMENT ON TABLE erp_master.material_plant_ext IS
'Material must be extended to a plant before GRN, issue, or transfer at that plant. Plant = project in PACE.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mce_material_company ON erp_master.material_company_ext (material_id, company_id);
CREATE INDEX IF NOT EXISTS idx_mpe_material_plant ON erp_master.material_plant_ext (material_id, company_id, plant_id);

COMMIT;
