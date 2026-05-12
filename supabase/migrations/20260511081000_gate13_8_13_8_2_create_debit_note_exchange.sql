/*
 * File-ID: 13.8.2
 * File-Path: supabase/migrations/20260511081000_gate13_8_13_8_2_create_debit_note_exchange.sql
 * Gate: 13.8
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Debit Note (formal vendor claim on RTV) and Exchange Reference (links return + replacement GRN).
 * Authority: Backend
 */

BEGIN;

-- Debit Note
-- Auto-created by handler when return_to_vendor.settlement_mode = DEBIT_NOTE
CREATE TABLE IF NOT EXISTS erp_procurement.debit_note (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (DN series)
  dn_number               text NOT NULL UNIQUE,

  dn_date                 date NOT NULL,
  system_created_at       timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema - plain uuid, NO FK
  company_id              uuid NOT NULL,
  vendor_id               uuid NOT NULL,

  -- Intra-schema FK - RTV that triggered this DN
  rtv_id                  uuid NOT NULL
    REFERENCES erp_procurement.return_to_vendor(id)
    ON DELETE RESTRICT,

  -- Debit Note Pricing (Section 98.5)
  -- Material value: return_qty × original GRN rate
  material_value          numeric(20, 4) NOT NULL CHECK (material_value >= 0),

  -- Freight + other landed costs: proportional to return qty (from Landed Cost record)
  -- Populated by handler from linked landed_cost record if available; Accounts can override
  freight_amount          numeric(20, 4) NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
  insurance_amount        numeric(20, 4) NOT NULL DEFAULT 0 CHECK (insurance_amount >= 0),
  customs_duty_amount     numeric(20, 4) NOT NULL DEFAULT 0 CHECK (customs_duty_amount >= 0),
  cha_charges_amount      numeric(20, 4) NOT NULL DEFAULT 0 CHECK (cha_charges_amount >= 0),

  -- Manual entries (Accounts enters)
  loading_charges         numeric(20, 4) NOT NULL DEFAULT 0 CHECK (loading_charges >= 0),
  unloading_charges       numeric(20, 4) NOT NULL DEFAULT 0 CHECK (unloading_charges >= 0),
  other_charges           numeric(20, 4) NOT NULL DEFAULT 0 CHECK (other_charges >= 0),

  -- Total = sum of all components (auto-calculated by handler; stored for reporting)
  total_value             numeric(20, 4) NOT NULL CHECK (total_value >= 0),

  -- DRAFT -> SENT -> ACKNOWLEDGED -> SETTLED
  status                  text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SENT', 'ACKNOWLEDGED', 'SETTLED')),

  sent_at                 timestamptz NULL,
  acknowledged_at         timestamptz NULL,
  settled_at              timestamptz NULL,

  remarks                 text NULL,
  created_by              uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  last_updated_at         timestamptz NULL
);

COMMENT ON TABLE erp_procurement.debit_note IS
'Formal debit note raised against vendor for returned material. Auto-created on RTV when settlement_mode = DEBIT_NOTE. Pricing: Material Value + Landed Cost components (proportional) + Loading/Unloading charges. Status: DRAFT->SENT->ACKNOWLEDGED->SETTLED.';

COMMENT ON COLUMN erp_procurement.debit_note.freight_amount IS
'Proportional freight from Landed Cost record linked to original GRN. Handler auto-populates if landed cost exists; Accounts can override. FOR freight_term POs: handler defaults to 0.';

-- Exchange Reference
-- Auto-created by handler when return_to_vendor.settlement_mode = EXCHANGE
-- Links original RTV (return leg) to replacement GRN (replacement leg)
CREATE TABLE IF NOT EXISTS erp_procurement.exchange_reference (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Unique exchange reference number - carried on both RTV and replacement GRN
  exchange_ref_number     text NOT NULL UNIQUE,

  system_created_at       timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema - plain uuid, NO FK
  company_id              uuid NOT NULL,
  vendor_id               uuid NOT NULL,

  -- Original RTV (return leg) - intra-schema FK
  rtv_id                  uuid NOT NULL
    REFERENCES erp_procurement.return_to_vendor(id)
    ON DELETE RESTRICT,

  -- Replacement GRN (replacement leg) - intra-schema FK
  -- NULL until replacement arrives
  replacement_grn_id      uuid NULL
    REFERENCES erp_procurement.goods_receipt(id)
    ON DELETE RESTRICT,

  -- RETURN_DISPATCHED -> REPLACEMENT_RECEIVED -> SETTLED
  status                  text NOT NULL DEFAULT 'RETURN_DISPATCHED'
    CHECK (status IN ('RETURN_DISPATCHED', 'REPLACEMENT_RECEIVED', 'SETTLED')),

  -- Settlement: net amount payable/receivable after exchange
  net_settlement_amount   numeric(20, 4) NULL,
  settled_at              timestamptz NULL,

  remarks                 text NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  last_updated_at         timestamptz NULL
);

COMMENT ON TABLE erp_procurement.exchange_reference IS
'Exchange record linking RTV return leg (P122) to vendor replacement GRN. Created when RTV settlement_mode = EXCHANGE. Replacement GRN references exchange_ref_number on receipt. Settlement = New Invoice − Return Value net.';

COMMIT;
