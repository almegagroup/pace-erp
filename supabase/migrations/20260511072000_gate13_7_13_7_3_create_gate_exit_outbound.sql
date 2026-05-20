/*
 * File-ID: 13.7.3
 * File-Path: supabase/migrations/20260511072000_gate13_7_13_7_3_create_gate_exit_outbound.sql
 * Gate: 13.7
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Outbound Gate Exit - truck exit on STO dispatch or Sales dispatch. Weighment for BULK/TANKER.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.gate_exit_outbound (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (GXO series)
  exit_number         text NOT NULL UNIQUE,

  exit_date           date NOT NULL,
  exit_time           time NULL,
  system_created_at   timestamptz NOT NULL DEFAULT now(),

  -- STO or SALES
  exit_type           text NOT NULL
    CHECK (exit_type IN ('STO', 'SALES', 'RTV')),

  -- Cross-schema - plain uuid, NO FK
  company_id          uuid NOT NULL,
  plant_id            uuid NULL,

  -- Intra-schema FKs (nullable - only one populated based on exit_type)
  sto_id              uuid NULL
    REFERENCES erp_procurement.stock_transfer_order(id)
    ON DELETE RESTRICT,

  -- Sales order / RTV ref - plain uuid (tables in later gates)
  sales_order_id      uuid NULL,
  rtv_id              uuid NULL,

  -- DC reference
  dc_id               uuid NULL
    REFERENCES erp_procurement.delivery_challan(id)
    ON DELETE RESTRICT,

  vehicle_number      text NOT NULL,
  driver_name         text NULL,
  gate_staff_id       uuid NOT NULL,

  -- Transporter - cross-schema plain uuid or free text
  transporter_id      uuid NULL,
  transporter_freetext text NULL,
  lr_number           text NULL,

  -- Weighment Fields (BULK/TANKER mandatory, STANDARD optional)
  rst_number          text NULL,
  gross_weight        numeric(20, 6) NULL CHECK (gross_weight >= 0),
  tare_weight         numeric(20, 6) NULL CHECK (tare_weight >= 0),
  net_weight          numeric(20, 6) NULL CHECK (net_weight >= 0),

  dispatch_qty        numeric(20, 6) NOT NULL,

  remarks             text NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_procurement.gate_exit_outbound IS
'Outbound Gate Exit for STO dispatch, Sales dispatch, and RTV (return to vendor). Same weighment rules as GE: BULK/TANKER mandatory, STANDARD optional. LR Number flows back to STO/CSN tracker.';

COMMIT;
