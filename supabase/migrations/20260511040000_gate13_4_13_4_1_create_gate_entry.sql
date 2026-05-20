/*
 * File-ID: 13.4.1
 * File-Path: supabase/migrations/20260511040000_gate13_4_13_4_1_create_gate_entry.sql
 * Gate: 13.4
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Gate Entry header + lines - multi-PO/STO receipt, weighment fields, CSN auto-link.
 * Authority: Backend
 */

BEGIN;

-- Gate Entry Header
CREATE TABLE IF NOT EXISTS erp_procurement.gate_entry (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric
  ge_number           text NOT NULL UNIQUE,

  -- User enters date (backdating allowed - Section 87.8)
  ge_date             date NOT NULL,
  -- System timestamp always recorded (cannot be altered)
  system_created_at   timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema - plain uuid, NO FK
  company_id          uuid NOT NULL,   -- -> erp_master.companies
  plant_id            uuid NULL,       -- -> erp_master.projects

  -- INBOUND_PO | INBOUND_STO
  -- INBOUND_PO: regular vendor delivery
  -- INBOUND_STO: receiving leg of STO (references STO instead of PO)
  ge_type             text NOT NULL DEFAULT 'INBOUND_PO'
    CHECK (ge_type IN ('INBOUND_PO', 'INBOUND_STO')),

  vehicle_number      text NOT NULL,
  driver_name         text NULL,

  -- Gate staff = logged-in user; stored here for record
  gate_staff_id       uuid NOT NULL,

  -- Status
  -- OPEN -> GRN_POSTED | CANCELLED
  status              text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'GRN_POSTED', 'CANCELLED')),

  remarks             text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_updated_at     timestamptz NULL
);

COMMENT ON TABLE erp_procurement.gate_entry IS
'Gate Entry header. One GE per truck arrival. Multi-line (multiple PO lines per truck). Backdating allowed - system timestamp always separate from user date. BULK/TANKER: weighment mandatory on lines.';

-- Gate Entry Lines
CREATE TABLE IF NOT EXISTS erp_procurement.gate_entry_line (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK
  gate_entry_id         uuid NOT NULL
    REFERENCES erp_procurement.gate_entry(id)
    ON DELETE RESTRICT,

  line_number           int NOT NULL,

  -- For INBOUND_PO: po_id + po_line_id set. For INBOUND_STO: sto_id + sto_line_id set.
  -- All intra-schema FKs - all these tables are in erp_procurement
  po_id                 uuid NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  po_line_id            uuid NULL
    REFERENCES erp_procurement.purchase_order_line(id)
    ON DELETE RESTRICT,

  -- STO reference (intra-schema - STO table created in Gate-13.7)
  -- Plain uuid to avoid ordering dependency - handler links after STO table exists
  sto_id                uuid NULL,   -- -> erp_procurement.stock_transfer_order
  sto_line_id           uuid NULL,   -- -> erp_procurement.stock_transfer_order_line

  -- CSN auto-link - plain uuid (CSN is in erp_procurement, but use plain uuid for flexibility)
  csn_id                uuid NULL
    REFERENCES erp_procurement.consignment_note(id)
    ON DELETE RESTRICT,

  -- Cross-schema - plain uuid, NO FK
  material_id           uuid NOT NULL,   -- -> erp_master.material_master

  -- Quantity entered by Security at gate
  ge_qty                numeric(20, 6) NOT NULL CHECK (ge_qty > 0),
  uom_code              text NOT NULL,

  -- Vendor invoice / BOE number
  -- For PO GE: vendor's delivery challan or invoice number
  -- For STO GE: Delivery Challan number from sending company
  challan_or_invoice_no text NULL,

  -- Weighment Fields (Section 91.3)
  -- BULK/TANKER: mandatory. STANDARD: optional.
  -- Validation rule enforced by handler, not DB constraint
  rst_number            text NULL,
  gross_weight          numeric(20, 6) NULL CHECK (gross_weight >= 0),
  tare_weight           numeric(20, 6) NULL CHECK (tare_weight >= 0),
  -- Net Weight = Gross - Tare (auto). Can be entered manually if weighbridge gives net directly.
  net_weight            numeric(20, 6) NULL CHECK (net_weight >= 0),
  net_weight_is_manual  boolean NOT NULL DEFAULT false,

  -- GRN posted against this line?
  grn_posted            boolean NOT NULL DEFAULT false,

  created_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (gate_entry_id, line_number)
);

COMMENT ON TABLE erp_procurement.gate_entry_line IS
'GE line. One per PO/STO line item on the truck. Weighment fields (RST/Gross/Tare/Net) present on all lines - mandatory for BULK/TANKER (enforced by handler), optional for STANDARD. grn_posted tracks whether GRN is done for this line.';

COMMENT ON COLUMN erp_procurement.gate_entry_line.net_weight IS
'Auto = Gross - Tare when both entered. Handler sets. net_weight_is_manual = true when Security enters net directly (weighbridge gives final net).';

COMMIT;
