/*
 * File-ID: 13.8.3
 * File-Path: supabase/migrations/20260511082000_gate13_8_13_8_3_create_landed_cost.sql
 * Gate: 13.8
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Landed Cost - per CSN/GRN, import bills entered by Accounts any time after GRN.
 * Authority: Backend
 */

BEGIN;

-- Landed Cost Header
-- One landed cost document per shipment/consignment (per GRN/CSN)
-- Accounts enters each bill as it arrives - no deadline (retroactive allowed)
CREATE TABLE IF NOT EXISTS erp_procurement.landed_cost (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (LC series)
  lc_number           text NOT NULL UNIQUE,

  lc_date             date NOT NULL,
  system_created_at   timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema - plain uuid, NO FK
  company_id          uuid NOT NULL,
  vendor_id           uuid NULL,

  -- Intra-schema FKs - GRN + CSN reference (both nullable - either or both may be linked)
  grn_id              uuid NULL
    REFERENCES erp_procurement.goods_receipt(id)
    ON DELETE RESTRICT,

  csn_id              uuid NULL
    REFERENCES erp_procurement.consignment_note(id)
    ON DELETE RESTRICT,

  po_id               uuid NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  -- DRAFT -> POSTED
  status              text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'POSTED')),

  -- Total value = sum of all landed_cost_line amounts
  total_cost          numeric(20, 4) NULL CHECK (total_cost >= 0),

  posted_by           uuid NULL,
  posted_at           timestamptz NULL,

  remarks             text NULL,
  created_by          uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_updated_at     timestamptz NULL
);

COMMENT ON TABLE erp_procurement.landed_cost IS
'Landed cost document - Accounts enters import bills (Freight, BOE, CHA, Insurance, etc.) per GRN/CSN. Any time after GRN - retroactive allowed. Multiple line items per document. Used for proportional allocation in Debit Note calculation.';

-- Landed Cost Lines
CREATE TABLE IF NOT EXISTS erp_procurement.landed_cost_line (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  lc_id           uuid NOT NULL
    REFERENCES erp_procurement.landed_cost(id)
    ON DELETE RESTRICT,

  line_number     int NOT NULL,

  -- Cost type (Section 87.9 + Section 100.4)
  cost_type       text NOT NULL
    CHECK (cost_type IN ('FREIGHT', 'INSURANCE', 'CUSTOMS_DUTY', 'CHA_CHARGES', 'LOADING', 'UNLOADING', 'PORT_CHARGES', 'OTHER')),

  -- CHA reference for CHA_CHARGES type - cross-schema plain uuid
  cha_id          uuid NULL,

  -- Bill reference (invoice/bill number for this cost)
  bill_reference  text NULL,
  bill_date       date NULL,

  description     text NULL,
  amount          numeric(20, 4) NOT NULL CHECK (amount > 0),

  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (lc_id, line_number)
);

COMMENT ON TABLE erp_procurement.landed_cost_line IS
'One line per cost component. cost_type drives debit note proportional calculation. cha_id optional - links CHA charges to specific agent for reporting. PORT_CHARGES and OTHER capture miscellaneous bills.';

COMMIT;
