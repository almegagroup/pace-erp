/*
 * File-ID: 12.8
 * File-Path: supabase/migrations/20260509127000_gate12_12_8_create_vendor_material_info.sql
 * Gate: 12
 * Phase: 12
 * Domain: MASTER
 * Purpose: Create the vendor-material info record table as the approved source list.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.vendor_material_info (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  vendor_id                   uuid NOT NULL
    REFERENCES erp_master.vendor_master(id)
    ON DELETE RESTRICT,

  material_id                 uuid NOT NULL
    REFERENCES erp_master.material_master(id)
    ON DELETE RESTRICT,

  -- Vendor's own code/description for this material (optional)
  vendor_material_code        text NULL,
  vendor_material_description text NULL,

  -- VENDOR-SPECIFIC PROCUREMENT DATA
  -- Human-readable pack description e.g. "25 KG Bag", "200 L Drum"
  pack_size_description       text NOT NULL,

  -- The UOM in which PO is raised for this vendor
  po_uom_code                 text NOT NULL
    REFERENCES erp_master.uom_master(code)
    ON DELETE RESTRICT,

  -- How many base UOM units = 1 PO UOM unit?
  -- e.g. po_uom = BAG, base_uom = KG, conversion_factor = 25 -> 1 BAG = 25 KG
  conversion_factor           numeric(20, 6) NOT NULL CHECK (conversion_factor > 0),

  -- If true: factor entered at GRN time (variable-weight bags)
  variable_conversion         boolean NOT NULL DEFAULT false,

  lead_time_days              int NULL CHECK (lead_time_days >= 0),

  -- Auto-updated on every GRN confirmation for this vendor+material
  last_purchase_price         numeric(20, 4) NULL,
  last_purchase_currency      text NULL,
  last_grn_date               date NULL,

  -- APPROVED SOURCE STATUS
  -- ACTIVE = approved source (PO allowed)
  -- INACTIVE = not approved (PO hard-blocked for this vendor+material)
  status                      text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),

  -- AUDIT
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL,
  last_updated_at             timestamptz NULL,
  last_updated_by             uuid NULL,

  UNIQUE (vendor_id, material_id)
);

COMMENT ON TABLE erp_master.vendor_material_info IS
'Vendor-Material Info Record = Approved Source List in PACE-ERP. ACTIVE record = approved to supply. INACTIVE = hard block at PO creation. No separate Approved Source List entity exists.';

COMMENT ON COLUMN erp_master.vendor_material_info.status IS
'ACTIVE = vendor approved to supply this material. PO line allowed. INACTIVE = hard block. PO line rejected with error: VENDOR_NOT_APPROVED_FOR_MATERIAL.';

COMMENT ON COLUMN erp_master.vendor_material_info.last_purchase_price IS
'Auto-updated by the GRN posting handler each time a GRN is confirmed for this vendor+material. Do not update manually.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vmi_vendor_material ON erp_master.vendor_material_info (vendor_id, material_id);
CREATE INDEX IF NOT EXISTS idx_vmi_material ON erp_master.vendor_material_info (material_id);
CREATE INDEX IF NOT EXISTS idx_vmi_status ON erp_master.vendor_material_info (status);

COMMIT;
