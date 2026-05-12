# OM-GATE-13.4 — Gate Entry + Inbound Gate Exit DB Spec
# PACE-ERP Operation Management — erp_procurement

**Gate:** 13.4
**Phase:** Operation Management — Layer 2
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-13.3 VERIFIED ✅
**Design Reference:** Sections 87.7–87.8, 88.1, 91.3, 102

---

## 1. What You Are Building

Gate Entry (GE) — Header + Lines (multi-PO, multi-line, weighment fields).  
Inbound Gate Exit — Tare weight capture for BULK/TANKER. Net Weight flows to GRN.  
All in `erp_procurement` schema.

---

## 2. Migration Files

---

### Migration 13.4.1 — Gate Entry
**File:** `20260511040000_gate13_4_13_4_1_create_gate_entry.sql`

```sql
/*
 * File-ID: 13.4.1
 * File-Path: supabase/migrations/20260511040000_gate13_4_13_4_1_create_gate_entry.sql
 * Gate: 13.4
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Gate Entry header + lines — multi-PO/STO receipt, weighment fields, CSN auto-link.
 * Authority: Backend
 */

BEGIN;

-- ── Gate Entry Header ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.gate_entry (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric
  ge_number           text NOT NULL UNIQUE,

  -- User enters date (backdating allowed — Section 87.8)
  ge_date             date NOT NULL,
  -- System timestamp always recorded (cannot be altered)
  system_created_at   timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema — plain uuid, NO FK
  company_id          uuid NOT NULL,   -- → erp_master.companies
  plant_id            uuid NULL,       -- → erp_master.projects

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
  -- OPEN → GRN_POSTED | CANCELLED
  status              text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'GRN_POSTED', 'CANCELLED')),

  remarks             text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_updated_at     timestamptz NULL
);

COMMENT ON TABLE erp_procurement.gate_entry IS
'Gate Entry header. One GE per truck arrival. Multi-line (multiple PO lines per truck). Backdating allowed — system timestamp always separate from user date. BULK/TANKER: weighment mandatory on lines.';

-- ── Gate Entry Lines ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.gate_entry_line (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK
  gate_entry_id         uuid NOT NULL
    REFERENCES erp_procurement.gate_entry(id)
    ON DELETE RESTRICT,

  line_number           int NOT NULL,

  -- For INBOUND_PO: po_id + po_line_id set. For INBOUND_STO: sto_id + sto_line_id set.
  -- All intra-schema FKs — all these tables are in erp_procurement
  po_id                 uuid NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  po_line_id            uuid NULL
    REFERENCES erp_procurement.purchase_order_line(id)
    ON DELETE RESTRICT,

  -- STO reference (intra-schema — STO table created in Gate-13.7)
  -- Plain uuid to avoid ordering dependency — handler links after STO table exists
  sto_id                uuid NULL,   -- → erp_procurement.stock_transfer_order
  sto_line_id           uuid NULL,   -- → erp_procurement.stock_transfer_order_line

  -- CSN auto-link — plain uuid (CSN is in erp_procurement, but use plain uuid for flexibility)
  csn_id                uuid NULL
    REFERENCES erp_procurement.consignment_note(id)
    ON DELETE RESTRICT,

  -- Cross-schema — plain uuid, NO FK
  material_id           uuid NOT NULL,   -- → erp_master.material_master

  -- Quantity entered by Security at gate
  ge_qty                numeric(20, 6) NOT NULL CHECK (ge_qty > 0),
  uom_code              text NOT NULL,

  -- Vendor invoice / BOE number
  -- For PO GE: vendor's delivery challan or invoice number
  -- For STO GE: Delivery Challan number from sending company
  challan_or_invoice_no text NULL,

  -- ── Weighment Fields (Section 91.3) ─────────────────────────────────────
  -- BULK/TANKER: mandatory. STANDARD: optional.
  -- Validation rule enforced by handler, not DB constraint
  rst_number            text NULL,
  gross_weight          numeric(20, 6) NULL CHECK (gross_weight >= 0),
  tare_weight           numeric(20, 6) NULL CHECK (tare_weight >= 0),
  -- Net Weight = Gross − Tare (auto). Can be entered manually if weighbridge gives net directly.
  net_weight            numeric(20, 6) NULL CHECK (net_weight >= 0),
  net_weight_is_manual  boolean NOT NULL DEFAULT false,

  -- GRN posted against this line?
  grn_posted            boolean NOT NULL DEFAULT false,

  created_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (gate_entry_id, line_number)
);

COMMENT ON TABLE erp_procurement.gate_entry_line IS
'GE line. One per PO/STO line item on the truck. Weighment fields (RST/Gross/Tare/Net) present on all lines — mandatory for BULK/TANKER (enforced by handler), optional for STANDARD. grn_posted tracks whether GRN is done for this line.';

COMMENT ON COLUMN erp_procurement.gate_entry_line.net_weight IS
'Auto = Gross − Tare when both entered. Handler sets. net_weight_is_manual = true when Security enters net directly (weighbridge gives final net).';

COMMIT;
```

---

### Migration 13.4.2 — Inbound Gate Exit
**File:** `20260511041000_gate13_4_13_4_2_create_gate_exit_inbound.sql`

```sql
/*
 * File-ID: 13.4.2
 * File-Path: supabase/migrations/20260511041000_gate13_4_13_4_2_create_gate_exit_inbound.sql
 * Gate: 13.4
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Inbound Gate Exit — tare weight after unloading. Net = GE Gross − Tare. Feeds GRN.
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

  -- Cross-schema — plain uuid, NO FK
  company_id            uuid NOT NULL,
  plant_id              uuid NULL,

  -- Intra-schema FK — links this exit to the arrival
  gate_entry_id         uuid NOT NULL
    REFERENCES erp_procurement.gate_entry(id)
    ON DELETE RESTRICT,

  -- One Gate Exit per Gate Entry (Section 102.4)
  -- UNIQUE enforced below

  -- Vehicle info — auto from GE; confirm or override
  vehicle_number        text NOT NULL,
  driver_name           text NULL,

  -- Gate staff = logged-in Security user
  gate_staff_id         uuid NOT NULL,

  -- ── Weighment Fields (Section 102.2) ─────────────────────────────────────
  -- BULK/TANKER: mandatory. STANDARD: optional.
  -- RST for tare — may be same slip as GE entry or separate
  rst_number_tare       text NULL,
  tare_weight           numeric(20, 6) NULL CHECK (tare_weight >= 0),

  -- Net Weight = GE Gross − Tare (auto-calculated by handler)
  -- This value is written back to gate_entry_line.net_weight and flows to GRN
  -- Read-only after calculation
  net_weight_calculated numeric(20, 6) NULL CHECK (net_weight_calculated >= 0),

  -- If weighbridge issues final net directly — enter here. Overrides auto-calculation.
  net_weight_override   numeric(20, 6) NULL CHECK (net_weight_override >= 0),

  remarks               text NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- One Gate Exit per Gate Entry
  UNIQUE (gate_entry_id)
);

COMMENT ON TABLE erp_procurement.gate_exit_inbound IS
'Inbound Gate Exit — records empty truck weight after unloading. BULK/TANKER: mandatory before GRN. STANDARD: optional. Net Weight = GE Gross − Tare is written back to gate_entry_line and defaults GRN received qty. One per GE.';

COMMENT ON COLUMN erp_procurement.gate_exit_inbound.net_weight_override IS
'If weighbridge issues final net directly, enter here. Takes precedence over net_weight_calculated. Handler uses: COALESCE(net_weight_override, net_weight_calculated).';

COMMIT;
```

---

### Migration 13.4.3 — Gate Entry Indexes
**File:** `20260511042000_gate13_4_13_4_3_create_gate_entry_indexes.sql`

```sql
/*
 * File-ID: 13.4.3
 * File-Path: supabase/migrations/20260511042000_gate13_4_13_4_3_create_gate_entry_indexes.sql
 * Gate: 13.4
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on gate_entry, gate_entry_line, gate_exit_inbound.
 * Authority: Backend
 */

BEGIN;

CREATE INDEX IF NOT EXISTS idx_ge_number    ON erp_procurement.gate_entry (ge_number);
CREATE INDEX IF NOT EXISTS idx_ge_company   ON erp_procurement.gate_entry (company_id);
CREATE INDEX IF NOT EXISTS idx_ge_date      ON erp_procurement.gate_entry (ge_date);
CREATE INDEX IF NOT EXISTS idx_ge_status    ON erp_procurement.gate_entry (status);

CREATE INDEX IF NOT EXISTS idx_gel_ge       ON erp_procurement.gate_entry_line (gate_entry_id);
CREATE INDEX IF NOT EXISTS idx_gel_po       ON erp_procurement.gate_entry_line (po_id) WHERE po_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gel_csn      ON erp_procurement.gate_entry_line (csn_id) WHERE csn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gel_material ON erp_procurement.gate_entry_line (material_id);

-- Partial index for open lines not yet GRN-posted (Section 13.5 in original Gate-13 spec)
CREATE INDEX IF NOT EXISTS idx_gel_grn_posted
  ON erp_procurement.gate_entry_line (gate_entry_id)
  WHERE grn_posted = false;

CREATE INDEX IF NOT EXISTS idx_gxi_ge       ON erp_procurement.gate_exit_inbound (gate_entry_id);
CREATE INDEX IF NOT EXISTS idx_gxi_company  ON erp_procurement.gate_exit_inbound (company_id);

GRANT SELECT ON erp_procurement.gate_entry         TO authenticated;
GRANT SELECT ON erp_procurement.gate_entry_line    TO authenticated;
GRANT SELECT ON erp_procurement.gate_exit_inbound  TO authenticated;
GRANT ALL    ON erp_procurement.gate_entry         TO service_role;
GRANT ALL    ON erp_procurement.gate_entry_line    TO service_role;
GRANT ALL    ON erp_procurement.gate_exit_inbound  TO service_role;

COMMIT;
```

---

## 3. Critical Rules

| Rule | Detail |
|---|---|
| sto_id, sto_line_id on gate_entry_line | Plain uuid NULL — STO table created in Gate-13.7 |
| csn_id on gate_entry_line | Intra-schema FK to consignment_note — CORRECT |
| UNIQUE(gate_entry_id) on gate_exit_inbound | One exit per GE |
| grn_posted partial index | WHERE grn_posted = false |
| BULK/TANKER weighment | DB allows null; handler enforces mandatory |

---

## 4. Verification — Claude Will Check

1. `gate_entry` ge_number UNIQUE, status CHECK (3 values), ge_type CHECK (2 values)
2. `gate_entry_line` UNIQUE(gate_entry_id, line_number)
3. `gate_entry_line.grn_posted` DEFAULT false
4. `gate_entry_line.csn_id` intra-schema FK to consignment_note
5. `gate_entry_line.sto_id` plain uuid NULL (no FK)
6. `gate_exit_inbound` UNIQUE(gate_entry_id) — one exit per GE
7. `gate_exit_inbound.gate_entry_id` intra-schema FK to gate_entry
8. Partial index `idx_gel_grn_posted` WHERE grn_posted = false
9. GRANT SELECT to authenticated on all 3 tables

---

*Spec frozen: 2026-05-11 | Reference: Sections 87.7–87.8, 88.1, 91.3, 102*
