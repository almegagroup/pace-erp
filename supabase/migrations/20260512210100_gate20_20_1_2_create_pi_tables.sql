/*
 * File-ID: 20.1.2
 * File-Path: supabase/migrations/20260512210100_gate20_20_1_2_create_pi_tables.sql
 * Gate: 20
 * Phase: 20
 * Domain: PROCUREMENT / INVENTORY
 * Purpose: Create physical inventory document, item, and posting-block tables.
 * Authority: Database
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.physical_inventory_document (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number       text NOT NULL UNIQUE,
  plant_id              uuid NOT NULL,
  storage_location_id   uuid NOT NULL,
  count_date            date NOT NULL,
  posting_date          date NOT NULL,
  mode                  text NOT NULL CHECK (mode IN ('LOCATION_WISE', 'ITEM_WISE')),
  status                text NOT NULL DEFAULT 'OPEN'
                          CHECK (status IN ('OPEN', 'COUNTED', 'POSTED')),
  notes                 text NULL,
  created_by            uuid NOT NULL,
  posted_by             uuid NULL,
  posted_at             timestamptz NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_procurement.physical_inventory_document IS
'Physical inventory count document per plant+storage_location. SAP MI01 equivalent.';

CREATE TABLE IF NOT EXISTS erp_procurement.physical_inventory_item (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id               uuid NOT NULL
    REFERENCES erp_procurement.physical_inventory_document(id) ON DELETE RESTRICT,
  line_number               int NOT NULL,
  material_id               uuid NOT NULL,
  stock_type                text NOT NULL
                              CHECK (stock_type IN ('UNRESTRICTED', 'QUALITY_INSPECTION', 'BLOCKED')),
  book_qty                  numeric(18,4) NOT NULL,
  base_uom_code             text NOT NULL,
  physical_qty              numeric(18,4) NULL,
  difference_qty            numeric(18,4) GENERATED ALWAYS AS (physical_qty - book_qty) STORED,
  is_recount_requested      boolean NOT NULL DEFAULT false,
  posted_stock_document_id  uuid NULL,
  counted_by                uuid NULL,
  counted_at                timestamptz NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),

  UNIQUE (document_id, material_id, stock_type)
);

COMMENT ON TABLE erp_procurement.physical_inventory_item IS
'Line items for physical inventory document. SAP MI04 count entry target.';

CREATE TABLE IF NOT EXISTS erp_inventory.physical_inventory_block (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id           uuid NOT NULL,
  plant_id              uuid NOT NULL,
  storage_location_id   uuid NOT NULL,
  pi_document_id        uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (material_id, plant_id, storage_location_id)
);

COMMENT ON TABLE erp_inventory.physical_inventory_block IS
'Posting block set on material+plant+sloc when a PI item is active. Cleared per-item on post.';

CREATE INDEX IF NOT EXISTS idx_pid_plant_status
  ON erp_procurement.physical_inventory_document (plant_id, status);

CREATE INDEX IF NOT EXISTS idx_pii_document_id
  ON erp_procurement.physical_inventory_item (document_id);

CREATE INDEX IF NOT EXISTS idx_pii_material
  ON erp_procurement.physical_inventory_item (material_id);

CREATE INDEX IF NOT EXISTS idx_pib_material_plant_sloc
  ON erp_inventory.physical_inventory_block (material_id, plant_id, storage_location_id);

GRANT ALL ON erp_procurement.physical_inventory_document TO service_role;
GRANT ALL ON erp_procurement.physical_inventory_item TO service_role;
GRANT ALL ON erp_inventory.physical_inventory_block TO service_role;

INSERT INTO erp_procurement.document_number_series (doc_type, pad_width, starting_number)
VALUES ('PI', 6, 1)
ON CONFLICT (doc_type) DO NOTHING;

COMMIT;
