/*
 * File-ID: 13.7.2
 * File-Path: supabase/migrations/20260511071000_gate13_7_13_7_2_create_delivery_challan.sql
 * Gate: 13.7
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Delivery Challan - auto-generated on stock issue for STO or Sales dispatch. Cannot be manually created.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.delivery_challan (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (DC series)
  dc_number                 text NOT NULL UNIQUE,

  dc_date                   date NOT NULL,
  system_created_at         timestamptz NOT NULL DEFAULT now(),

  -- STO or SALES
  dc_type                   text NOT NULL
    CHECK (dc_type IN ('STO', 'SALES')),

  -- Cross-schema - plain uuid, NO FK
  selling_company_id        uuid NOT NULL,
  receiving_company_id      uuid NULL,
  -- External customer reference (for SALES type)
  customer_id               uuid NULL,

  -- Intra-schema FK (for STO type)
  sto_id                    uuid NULL
    REFERENCES erp_procurement.stock_transfer_order(id)
    ON DELETE RESTRICT,

  -- For SALES type - intra-schema FK to sales_order (created in Gate-13.9)
  -- Plain uuid to avoid ordering dependency
  sales_order_id            uuid NULL,

  delivery_address          text NULL,

  -- Transport info (filled by Gate Exit handler)
  transporter_id            uuid NULL,
  transporter_name_freetext text NULL,
  vehicle_number            text NULL,
  lr_number                 text NULL,
  driver_name               text NULL,

  -- AUTO_GENERATED -> DISPATCHED
  status                    text NOT NULL DEFAULT 'AUTO_GENERATED'
    CHECK (status IN ('AUTO_GENERATED', 'DISPATCHED')),

  total_value               numeric(20, 4) NULL,
  remarks                   text NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_procurement.delivery_challan IS
'Delivery Challan - auto-generated on stock issue. Cannot be manually created. dc_type = STO or SALES. Transport info (vehicle, LR) filled by Gate Exit handler at dispatch.';

-- DC Lines
CREATE TABLE IF NOT EXISTS erp_procurement.delivery_challan_line (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dc_id             uuid NOT NULL
    REFERENCES erp_procurement.delivery_challan(id)
    ON DELETE RESTRICT,
  line_number       int NOT NULL,

  -- Cross-schema - plain uuid
  material_id       uuid NOT NULL,

  -- STO line ref (intra-schema)
  sto_line_id       uuid NULL
    REFERENCES erp_procurement.stock_transfer_order_line(id)
    ON DELETE RESTRICT,

  -- SO line ref - plain uuid (SO table in Gate-13.9)
  so_line_id        uuid NULL,

  quantity          numeric(20, 6) NOT NULL,
  uom_code          text NOT NULL,
  unit_value        numeric(20, 4) NULL,
  line_total        numeric(20, 4) NULL,

  -- erp_inventory stock document reference
  stock_document_id uuid NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (dc_id, line_number)
);

COMMIT;
