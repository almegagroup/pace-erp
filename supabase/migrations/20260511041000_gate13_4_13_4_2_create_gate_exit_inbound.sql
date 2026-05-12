/*
 * File-ID: 13.4.2
 * File-Path: supabase/migrations/20260511041000_gate13_4_13_4_2_create_gate_exit_inbound.sql
 * Gate: 13.4
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Inbound Gate Exit - tare weight after unloading. Net = GE Gross - Tare. Feeds GRN.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.gate_exit_inbound (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (GEX series)
  exit_number           text NOT NULL UNIQUE,

  -- User enters date/time (backdating allowed)
  exit_date             date NOT NULL,
  exit_time             time NULL,
  system_created_at     timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema - plain uuid, NO FK
  company_id            uuid NOT NULL,
  plant_id              uuid NULL,

  -- Intra-schema FK - links this exit to the arrival
  gate_entry_id         uuid NOT NULL
    REFERENCES erp_procurement.gate_entry(id)
    ON DELETE RESTRICT,

  -- One Gate Exit per Gate Entry (Section 102.4)
  -- UNIQUE enforced below

  -- Vehicle info - auto from GE; confirm or override
  vehicle_number        text NOT NULL,
  driver_name           text NULL,

  -- Gate staff = logged-in Security user
  gate_staff_id         uuid NOT NULL,

  -- Weighment Fields (Section 102.2)
  -- BULK/TANKER: mandatory. STANDARD: optional.
  -- RST for tare - may be same slip as GE entry or separate
  rst_number_tare       text NULL,
  tare_weight           numeric(20, 6) NULL CHECK (tare_weight >= 0),

  -- Net Weight = GE Gross - Tare (auto-calculated by handler)
  -- This value is written back to gate_entry_line.net_weight and flows to GRN
  -- Read-only after calculation
  net_weight_calculated numeric(20, 6) NULL CHECK (net_weight_calculated >= 0),

  -- If weighbridge issues final net directly - enter here. Overrides auto-calculation.
  net_weight_override   numeric(20, 6) NULL CHECK (net_weight_override >= 0),

  remarks               text NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- One Gate Exit per Gate Entry
  UNIQUE (gate_entry_id)
);

COMMENT ON TABLE erp_procurement.gate_exit_inbound IS
'Inbound Gate Exit - records empty truck weight after unloading. BULK/TANKER: mandatory before GRN. STANDARD: optional. Net Weight = GE Gross - Tare is written back to gate_entry_line and defaults GRN received qty. One per GE.';

COMMENT ON COLUMN erp_procurement.gate_exit_inbound.net_weight_override IS
'If weighbridge issues final net directly, enter here. Takes precedence over net_weight_calculated. Handler uses: COALESCE(net_weight_override, net_weight_calculated).';

COMMIT;
