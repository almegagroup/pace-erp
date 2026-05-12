/*
 * File-ID: 13.7.1
 * File-Path: supabase/migrations/20260511070000_gate13_7_13_7_1_create_stock_transfer_order.sql
 * Gate: 13.7
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: STO header + lines - CONSIGNMENT_DISTRIBUTION and INTER_PLANT types, same workflow.
 * Authority: Backend
 */

BEGIN;

-- STO Header
CREATE TABLE IF NOT EXISTS erp_procurement.stock_transfer_order (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (STO series)
  sto_number            text NOT NULL UNIQUE,

  sto_date              date NOT NULL,
  system_created_at     timestamptz NOT NULL DEFAULT now(),

  -- CONSIGNMENT_DISTRIBUTION: Sub CSN -> STO transform
  -- INTER_PLANT: independent inter-company transfer
  sto_type              text NOT NULL
    CHECK (sto_type IN ('CONSIGNMENT_DISTRIBUTION', 'INTER_PLANT')),

  -- Cross-schema - plain uuid, NO FK
  sending_company_id    uuid NOT NULL,
  receiving_company_id  uuid NOT NULL,

  -- CSN link - intra-schema FK (for CONSIGNMENT_DISTRIBUTION only)
  related_csn_id        uuid NULL
    REFERENCES erp_procurement.consignment_note(id)
    ON DELETE RESTRICT,

  -- CREATED -> DISPATCHED -> RECEIVED -> CLOSED
  status                text NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED', 'DISPATCHED', 'RECEIVED', 'CLOSED', 'CANCELLED')),

  cancellation_reason   text NULL,
  cancelled_at          timestamptz NULL,
  cancelled_by          uuid NULL,

  remarks               text NULL,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_updated_at       timestamptz NULL,
  last_updated_by       uuid NULL
);

COMMENT ON TABLE erp_procurement.stock_transfer_order IS
'STO header. Both types (CONSIGNMENT_DISTRIBUTION and INTER_PLANT) use the same document structure and workflow. Transfer price is dynamic last-used per material + sending + receiving company pair.';

-- STO Lines
CREATE TABLE IF NOT EXISTS erp_procurement.stock_transfer_order_line (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  sto_id                        uuid NOT NULL
    REFERENCES erp_procurement.stock_transfer_order(id)
    ON DELETE RESTRICT,

  line_number                   int NOT NULL,

  -- Cross-schema - plain uuid, NO FK
  material_id                   uuid NOT NULL,
  -- Sending storage location - cross-schema to erp_inventory
  sending_storage_location_id   uuid NULL,
  -- Default receiving location from Material Master - overridable at GRN
  receiving_storage_location_id uuid NULL,

  quantity                      numeric(20, 6) NOT NULL CHECK (quantity > 0),
  uom_code                      text NOT NULL,

  -- Dynamic last-used transfer price (same pattern as payment terms)
  transfer_price                numeric(20, 4) NULL CHECK (transfer_price >= 0),
  transfer_price_currency       text NOT NULL DEFAULT 'BDT',

  -- Auto-updated by dispatch + receipt handlers
  dispatched_qty                numeric(20, 6) NOT NULL DEFAULT 0,
  received_qty                  numeric(20, 6) NOT NULL DEFAULT 0,
  -- Balance = quantity - received_qty
  balance_qty                   numeric(20, 6) NOT NULL,

  -- OPEN -> RECEIVED | KNOCKED_OFF
  line_status                   text NOT NULL DEFAULT 'OPEN'
    CHECK (line_status IN ('OPEN', 'RECEIVED', 'KNOCKED_OFF')),

  knock_off_reason              text NULL,
  knocked_off_by                uuid NULL,
  knocked_off_at                timestamptz NULL,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  last_updated_at               timestamptz NULL,

  UNIQUE (sto_id, line_number)
);

COMMENT ON TABLE erp_procurement.stock_transfer_order_line IS
'STO line. transfer_price defaults to last used for this material + sending + receiving company combination. Editable until Delivery Challan is generated.';

COMMIT;
