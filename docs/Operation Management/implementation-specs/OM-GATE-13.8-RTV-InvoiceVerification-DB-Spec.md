# OM-GATE-13.8 — RTV + Debit Note + Exchange + Landed Cost + Invoice Verification DB Spec
# PACE-ERP Operation Management — erp_procurement

**Gate:** 13.8
**Phase:** Operation Management — Layer 2
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-13.7 VERIFIED ✅
**Design Reference:** Sections 87.9, 98, 100

---

## 1. What You Are Building

- Return to Vendor (RTV) — header + lines, P122 movement, 3 settlement modes
- Debit Note — formal debit raised against vendor on DEBIT_NOTE settlement
- Exchange Reference — links RTV return leg to replacement GRN leg
- Landed Cost — per CSN/GRN, import bills (Freight, BOE, CHA, Insurance, etc.)
- Invoice Verification (IV) — 3-way match, domestic + import, GST verification

All in `erp_procurement` schema.

---

## 2. Codex Instructions — Read This First

**File header:**
```sql
/*
 * File-ID: 13.8.X
 * File-Path: supabase/migrations/20260511HHMMSS_gate13_8_13_8_X_description.sql
 * Gate: 13.8
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: One sentence.
 * Authority: Backend
 */
```

**Cross-schema FK rule:** company_id, vendor_id, material_id, storage_location_id, cha_id, customer_id — all plain uuid, NO REFERENCES.

**Intra-schema FKs allowed** — all tables in erp_procurement can reference each other with REFERENCES.

---

## 3. Migration Files

---

### Migration 13.8.1 — Return to Vendor
**File:** `20260511080000_gate13_8_13_8_1_create_return_to_vendor.sql`

```sql
/*
 * File-ID: 13.8.1
 * File-Path: supabase/migrations/20260511080000_gate13_8_13_8_1_create_return_to_vendor.sql
 * Gate: 13.8
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Return to Vendor header + lines — P122 movement from BLOCKED stock to vendor.
 * Authority: Backend
 */

BEGIN;

-- ── RTV Header ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.return_to_vendor (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (RTV series)
  rtv_number            text NOT NULL UNIQUE,

  rtv_date              date NOT NULL,
  system_created_at     timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema — plain uuid, NO FK
  company_id            uuid NOT NULL,   -- → erp_master.companies
  vendor_id             uuid NOT NULL,   -- → erp_master.vendor_master

  -- Intra-schema FKs
  grn_id                uuid NOT NULL
    REFERENCES erp_procurement.goods_receipt(id)
    ON DELETE RESTRICT,

  po_id                 uuid NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  -- Return reason
  -- Section 98.1: QA_FAILURE / EXCESS_DELIVERY / WRONG_MATERIAL / DAMAGED / QUALITY_DEVIATION / OTHER
  reason_category       text NOT NULL
    CHECK (reason_category IN ('QA_FAILURE', 'EXCESS_DELIVERY', 'WRONG_MATERIAL', 'DAMAGED', 'QUALITY_DEVIATION', 'OTHER')),
  reason_text           text NULL,   -- Free text detail. Mandatory if reason_category = OTHER

  -- Settlement Mode (Section 98.5)
  settlement_mode       text NOT NULL
    CHECK (settlement_mode IN ('DEBIT_NOTE', 'NEXT_INVOICE_ADJUST', 'EXCHANGE')),

  -- Exchange reference number — auto-created by handler when settlement_mode = EXCHANGE
  exchange_ref_number   text NULL,

  -- Pending return credit (for NEXT_INVOICE_ADJUST mode)
  -- Populated by handler after Gate Exit (P122 posted). Amount = sum of line values.
  pending_credit_amount numeric(20, 4) NULL CHECK (pending_credit_amount >= 0),
  credit_adjusted_at    timestamptz NULL,  -- When credit was used against next invoice

  -- CREATED → DISPATCHED → SETTLED
  status                text NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED', 'DISPATCHED', 'SETTLED', 'CANCELLED')),

  -- Gate Exit — plain uuid (gate_exit_outbound.rtv_id links back to this)
  gate_exit_id          uuid NULL,   -- → erp_procurement.gate_exit_outbound

  cancellation_reason   text NULL,
  cancelled_at          timestamptz NULL,
  cancelled_by          uuid NULL,

  remarks               text NULL,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_updated_at       timestamptz NULL,
  last_updated_by       uuid NULL
);

COMMENT ON TABLE erp_procurement.return_to_vendor IS
'RTV — return material from BLOCKED stock to vendor (P122). Three settlement modes: DEBIT_NOTE (formal DN raised), NEXT_INVOICE_ADJUST (credit tracked against next invoice), EXCHANGE (replacement GRN linked via exchange_reference). Import RTV: Gate Exit optional.';

COMMENT ON COLUMN erp_procurement.return_to_vendor.settlement_mode IS
'DEBIT_NOTE: debit_note record auto-created. NEXT_INVOICE_ADJUST: pending_credit_amount tracked. EXCHANGE: exchange_reference record auto-created; replacement GRN linked via exchange_ref_number.';

-- ── RTV Lines ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.return_to_vendor_line (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  rtv_id                uuid NOT NULL
    REFERENCES erp_procurement.return_to_vendor(id)
    ON DELETE RESTRICT,

  line_number           int NOT NULL,

  -- Intra-schema FK
  grn_line_id           uuid NOT NULL
    REFERENCES erp_procurement.goods_receipt_line(id)
    ON DELETE RESTRICT,

  -- Cross-schema — plain uuid, NO FK
  material_id           uuid NOT NULL,   -- → erp_master.material_master
  -- From BLOCKED stock — cross-schema to erp_inventory
  storage_location_id   uuid NULL,       -- → erp_inventory.storage_location_master

  original_grn_qty      numeric(20, 6) NOT NULL,  -- Read-only reference from GRN line
  return_qty            numeric(20, 6) NOT NULL CHECK (return_qty > 0),
  uom_code              text NOT NULL,

  -- Rate from original GRN (for debit note calculation)
  grn_rate              numeric(20, 4) NULL,

  -- Line value = return_qty × grn_rate
  line_value            numeric(20, 4) NULL,

  -- Movement type — always P122 for RTV
  movement_type_code    text NOT NULL DEFAULT 'P122'
    CHECK (movement_type_code = 'P122'),

  -- erp_inventory cross-schema references (plain uuid — no FK)
  stock_document_id     uuid NULL,   -- → erp_inventory.stock_document (set after P122 posting)
  stock_ledger_id       uuid NULL,   -- → erp_inventory.stock_ledger (set after P122 posting)

  created_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (rtv_id, line_number)
);

COMMENT ON TABLE erp_procurement.return_to_vendor_line IS
'RTV line. Partial return allowed — return_qty can be less than original_grn_qty. Remaining qty stays in BLOCKED. P122 movement posts from BLOCKED → out. stock_document_id + stock_ledger_id set after posting.';

COMMIT;
```

---

### Migration 13.8.2 — Debit Note + Exchange Reference
**File:** `20260511081000_gate13_8_13_8_2_create_debit_note_exchange.sql`

```sql
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

-- ── Debit Note ───────────────────────────────────────────────────────────────
-- Auto-created by handler when return_to_vendor.settlement_mode = DEBIT_NOTE
CREATE TABLE IF NOT EXISTS erp_procurement.debit_note (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (DN series)
  dn_number               text NOT NULL UNIQUE,

  dn_date                 date NOT NULL,
  system_created_at       timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema — plain uuid, NO FK
  company_id              uuid NOT NULL,
  vendor_id               uuid NOT NULL,

  -- Intra-schema FK — RTV that triggered this DN
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

  -- DRAFT → SENT → ACKNOWLEDGED → SETTLED
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
'Formal debit note raised against vendor for returned material. Auto-created on RTV when settlement_mode = DEBIT_NOTE. Pricing: Material Value + Landed Cost components (proportional) + Loading/Unloading charges. Status: DRAFT→SENT→ACKNOWLEDGED→SETTLED.';

COMMENT ON COLUMN erp_procurement.debit_note.freight_amount IS
'Proportional freight from Landed Cost record linked to original GRN. Handler auto-populates if landed cost exists; Accounts can override. FOR freight_term POs: handler defaults to 0.';

-- ── Exchange Reference ────────────────────────────────────────────────────────
-- Auto-created by handler when return_to_vendor.settlement_mode = EXCHANGE
-- Links original RTV (return leg) to replacement GRN (replacement leg)
CREATE TABLE IF NOT EXISTS erp_procurement.exchange_reference (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Unique exchange reference number — carried on both RTV and replacement GRN
  exchange_ref_number     text NOT NULL UNIQUE,

  system_created_at       timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema — plain uuid, NO FK
  company_id              uuid NOT NULL,
  vendor_id               uuid NOT NULL,

  -- Original RTV (return leg) — intra-schema FK
  rtv_id                  uuid NOT NULL
    REFERENCES erp_procurement.return_to_vendor(id)
    ON DELETE RESTRICT,

  -- Replacement GRN (replacement leg) — intra-schema FK
  -- NULL until replacement arrives
  replacement_grn_id      uuid NULL
    REFERENCES erp_procurement.goods_receipt(id)
    ON DELETE RESTRICT,

  -- RETURN_DISPATCHED → REPLACEMENT_RECEIVED → SETTLED
  status                  text NOT NULL DEFAULT 'RETURN_DISPATCHED'
    CHECK (status IN ('RETURN_DISPATCHED', 'REPLACEMENT_RECEIVED', 'SETTLED')),

  -- Settlement: net amount payable/receivable after exchange
  net_settlement_amount   numeric(20, 4) NULL,  -- Positive = vendor owes; Negative = we owe
  settled_at              timestamptz NULL,

  remarks                 text NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  last_updated_at         timestamptz NULL
);

COMMENT ON TABLE erp_procurement.exchange_reference IS
'Exchange record linking RTV return leg (P122) to vendor replacement GRN. Created when RTV settlement_mode = EXCHANGE. Replacement GRN references exchange_ref_number on receipt. Settlement = New Invoice − Return Value net.';

COMMIT;
```

---

### Migration 13.8.3 — Landed Cost
**File:** `20260511082000_gate13_8_13_8_3_create_landed_cost.sql`

```sql
/*
 * File-ID: 13.8.3
 * File-Path: supabase/migrations/20260511082000_gate13_8_13_8_3_create_landed_cost.sql
 * Gate: 13.8
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Landed Cost — per CSN/GRN, import bills entered by Accounts any time after GRN.
 * Authority: Backend
 */

BEGIN;

-- ── Landed Cost Header ───────────────────────────────────────────────────────
-- One landed cost document per shipment/consignment (per GRN/CSN)
-- Accounts enters each bill as it arrives — no deadline (retroactive allowed)
CREATE TABLE IF NOT EXISTS erp_procurement.landed_cost (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (LC series)
  lc_number           text NOT NULL UNIQUE,

  lc_date             date NOT NULL,
  system_created_at   timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema — plain uuid, NO FK
  company_id          uuid NOT NULL,
  vendor_id           uuid NULL,    -- NULL for bills from non-vendor parties (CHA, port authority, etc.)

  -- Intra-schema FKs — GRN + CSN reference (both nullable — either or both may be linked)
  grn_id              uuid NULL
    REFERENCES erp_procurement.goods_receipt(id)
    ON DELETE RESTRICT,

  csn_id              uuid NULL
    REFERENCES erp_procurement.consignment_note(id)
    ON DELETE RESTRICT,

  po_id               uuid NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  -- DRAFT → POSTED
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
'Landed cost document — Accounts enters import bills (Freight, BOE, CHA, Insurance, etc.) per GRN/CSN. Any time after GRN — retroactive allowed. Multiple line items per document. Used for proportional allocation in Debit Note calculation.';

-- ── Landed Cost Lines ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.landed_cost_line (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  lc_id           uuid NOT NULL
    REFERENCES erp_procurement.landed_cost(id)
    ON DELETE RESTRICT,

  line_number     int NOT NULL,

  -- Cost type (Section 87.9 + Section 100.4)
  cost_type       text NOT NULL
    CHECK (cost_type IN ('FREIGHT', 'INSURANCE', 'CUSTOMS_DUTY', 'CHA_CHARGES', 'LOADING', 'UNLOADING', 'PORT_CHARGES', 'OTHER')),

  -- CHA reference for CHA_CHARGES type — cross-schema plain uuid
  cha_id          uuid NULL,   -- → erp_master.cha_master

  -- Bill reference (invoice/bill number for this cost)
  bill_reference  text NULL,
  bill_date       date NULL,

  description     text NULL,
  amount          numeric(20, 4) NOT NULL CHECK (amount > 0),

  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (lc_id, line_number)
);

COMMENT ON TABLE erp_procurement.landed_cost_line IS
'One line per cost component. cost_type drives debit note proportional calculation. cha_id optional — links CHA charges to specific agent for reporting. PORT_CHARGES and OTHER capture miscellaneous bills.';

COMMIT;
```

---

### Migration 13.8.4 — Invoice Verification
**File:** `20260511083000_gate13_8_13_8_4_create_invoice_verification.sql`

```sql
/*
 * File-ID: 13.8.4
 * File-Path: supabase/migrations/20260511083000_gate13_8_13_8_4_create_invoice_verification.sql
 * Gate: 13.8
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Invoice Verification header + lines — 3-way match, GST verification, 50% tolerance hard block.
 * Authority: Backend
 */

BEGIN;

-- ── Invoice Verification Header ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.invoice_verification (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (IV series)
  iv_number               text NOT NULL UNIQUE,

  iv_date                 date NOT NULL,
  system_created_at       timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema — plain uuid, NO FK
  company_id              uuid NOT NULL,
  vendor_id               uuid NOT NULL,

  -- PO reference — intra-schema FK (auto-loaded from GRN lines selected)
  po_id                   uuid NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  -- Vendor's own invoice details (mandatory)
  vendor_invoice_number   text NOT NULL,
  vendor_invoice_date     date NOT NULL,

  -- DRAFT → MATCHED → POSTED | BLOCKED (Section 100.5)
  -- DRAFT: user building IV
  -- MATCHED: all lines within 50% tolerance — ready to post
  -- BLOCKED: at least one line > 50% variance — cannot post
  -- POSTED: liability created — payment can proceed
  status                  text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'MATCHED', 'POSTED', 'BLOCKED')),

  -- Totals (auto-computed by handler from lines, stored for reporting)
  total_taxable_value     numeric(20, 4) NULL CHECK (total_taxable_value >= 0),
  total_gst_amount        numeric(20, 4) NULL CHECK (total_gst_amount >= 0),
  total_invoice_value     numeric(20, 4) NULL CHECK (total_invoice_value >= 0),

  posted_by               uuid NULL,
  posted_at               timestamptz NULL,

  remarks                 text NULL,
  created_by              uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  last_updated_at         timestamptz NULL,
  last_updated_by         uuid NULL
);

COMMENT ON TABLE erp_procurement.invoice_verification IS
'IV — SAP MIRO equivalent. One IV can reference multiple GRN lines from same vendor. 3-way match: PO Rate vs Invoice Rate. Hard block if |Invoice Rate − PO Rate| / PO Rate > 50%. Partial invoicing allowed — each partial IV is a separate document.';

COMMENT ON COLUMN erp_procurement.invoice_verification.status IS
'DRAFT: building. MATCHED: all lines ≤50% variance. BLOCKED: at least one line >50% variance (cannot post). POSTED: liability recorded.';

-- ── Invoice Verification Lines ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.invoice_verification_line (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK
  iv_id                   uuid NOT NULL
    REFERENCES erp_procurement.invoice_verification(id)
    ON DELETE RESTRICT,

  line_number             int NOT NULL,

  -- GRN reference (intra-schema FK)
  grn_id                  uuid NOT NULL
    REFERENCES erp_procurement.goods_receipt(id)
    ON DELETE RESTRICT,

  grn_line_id             uuid NOT NULL
    REFERENCES erp_procurement.goods_receipt_line(id)
    ON DELETE RESTRICT,

  -- Cross-schema — plain uuid, NO FK
  material_id             uuid NOT NULL,   -- → erp_master.material_master

  -- Quantities
  grn_qty                 numeric(20, 6) NOT NULL,   -- Read-only from GRN line
  invoice_qty             numeric(20, 6) NOT NULL CHECK (invoice_qty > 0),
  uom_code                text NOT NULL,

  -- 3-Way Match (Section 100.2)
  po_rate                 numeric(20, 4) NOT NULL,   -- Read-only from PO line
  invoice_rate            numeric(20, 4) NOT NULL CHECK (invoice_rate > 0),

  -- |invoice_rate − po_rate| / po_rate × 100. Auto-computed by handler, stored for reporting.
  rate_variance_pct       numeric(10, 4) NULL CHECK (rate_variance_pct >= 0),

  -- MATCHED: variance ≤ 50%. BLOCKED: variance > 50%. PENDING: not yet evaluated.
  match_status            text NOT NULL DEFAULT 'PENDING'
    CHECK (match_status IN ('MATCHED', 'BLOCKED', 'PENDING')),

  -- Taxable value = invoice_rate × invoice_qty
  taxable_value           numeric(20, 4) NULL CHECK (taxable_value >= 0),

  -- ── GST Fields (Section 100.3 — Domestic) ────────────────────────────────
  -- gst_type derived from vendor state vs company state (intra-state vs inter-state)
  -- NONE for import vendor invoices (no GST on import — BOE/customs handled in Landed Cost)
  gst_type                text NOT NULL DEFAULT 'NONE'
    CHECK (gst_type IN ('CGST_SGST', 'IGST', 'NONE')),

  gst_rate                numeric(6, 2) NULL CHECK (gst_rate >= 0),

  -- Calculated GST amounts (auto from taxable_value × gst_rate; stored for reporting)
  cgst_amount             numeric(20, 4) NULL CHECK (cgst_amount >= 0),
  sgst_amount             numeric(20, 4) NULL CHECK (sgst_amount >= 0),
  igst_amount             numeric(20, 4) NULL CHECK (igst_amount >= 0),

  -- GST amount as stated on vendor's physical invoice (user enters)
  invoice_gst_amount      numeric(20, 4) NULL CHECK (invoice_gst_amount >= 0),

  -- GST match: true when calculated = invoice_gst_amount (tolerance by handler)
  gst_match_flag          boolean NOT NULL DEFAULT false,

  created_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (iv_id, line_number)
);

COMMENT ON TABLE erp_procurement.invoice_verification_line IS
'IV line. One per GRN line selected. Hard block when rate_variance_pct > 50 — IV cannot be posted until resolved (PO amendment or corrected invoice entry). Partial invoicing: invoice_qty can be less than grn_qty — remainder stays open for next IV.';

COMMENT ON COLUMN erp_procurement.invoice_verification_line.gst_type IS
'CGST_SGST: intra-state domestic. IGST: inter-state domestic. NONE: import vendor invoice (no GST on import — customs/duties go to Landed Cost module).';

COMMIT;
```

---

### Migration 13.8.5 — Indexes + Grants
**File:** `20260511084000_gate13_8_13_8_5_create_indexes.sql`

```sql
/*
 * File-ID: 13.8.5
 * File-Path: supabase/migrations/20260511084000_gate13_8_13_8_5_create_indexes.sql
 * Gate: 13.8
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on RTV, Debit Note, Exchange, Landed Cost, and Invoice Verification tables.
 * Authority: Backend
 */

BEGIN;

-- RTV indexes
CREATE INDEX IF NOT EXISTS idx_rtv_number     ON erp_procurement.return_to_vendor (rtv_number);
CREATE INDEX IF NOT EXISTS idx_rtv_company    ON erp_procurement.return_to_vendor (company_id);
CREATE INDEX IF NOT EXISTS idx_rtv_vendor     ON erp_procurement.return_to_vendor (vendor_id);
CREATE INDEX IF NOT EXISTS idx_rtv_grn        ON erp_procurement.return_to_vendor (grn_id);
CREATE INDEX IF NOT EXISTS idx_rtv_status     ON erp_procurement.return_to_vendor (status);
CREATE INDEX IF NOT EXISTS idx_rtv_settlement ON erp_procurement.return_to_vendor (settlement_mode);

CREATE INDEX IF NOT EXISTS idx_rtvl_rtv       ON erp_procurement.return_to_vendor_line (rtv_id);
CREATE INDEX IF NOT EXISTS idx_rtvl_material  ON erp_procurement.return_to_vendor_line (material_id);

-- Debit Note indexes
CREATE INDEX IF NOT EXISTS idx_dn_number      ON erp_procurement.debit_note (dn_number);
CREATE INDEX IF NOT EXISTS idx_dn_vendor      ON erp_procurement.debit_note (vendor_id);
CREATE INDEX IF NOT EXISTS idx_dn_rtv         ON erp_procurement.debit_note (rtv_id);
CREATE INDEX IF NOT EXISTS idx_dn_status      ON erp_procurement.debit_note (status);

-- Exchange Reference indexes
CREATE INDEX IF NOT EXISTS idx_exr_number     ON erp_procurement.exchange_reference (exchange_ref_number);
CREATE INDEX IF NOT EXISTS idx_exr_rtv        ON erp_procurement.exchange_reference (rtv_id);
CREATE INDEX IF NOT EXISTS idx_exr_grn        ON erp_procurement.exchange_reference (replacement_grn_id) WHERE replacement_grn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exr_status     ON erp_procurement.exchange_reference (status);

-- Landed Cost indexes
CREATE INDEX IF NOT EXISTS idx_lc_number      ON erp_procurement.landed_cost (lc_number);
CREATE INDEX IF NOT EXISTS idx_lc_company     ON erp_procurement.landed_cost (company_id);
CREATE INDEX IF NOT EXISTS idx_lc_grn         ON erp_procurement.landed_cost (grn_id) WHERE grn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lc_csn         ON erp_procurement.landed_cost (csn_id) WHERE csn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lc_status      ON erp_procurement.landed_cost (status);

CREATE INDEX IF NOT EXISTS idx_lcl_lc         ON erp_procurement.landed_cost_line (lc_id);
CREATE INDEX IF NOT EXISTS idx_lcl_type       ON erp_procurement.landed_cost_line (cost_type);

-- Invoice Verification indexes
CREATE INDEX IF NOT EXISTS idx_iv_number      ON erp_procurement.invoice_verification (iv_number);
CREATE INDEX IF NOT EXISTS idx_iv_company     ON erp_procurement.invoice_verification (company_id);
CREATE INDEX IF NOT EXISTS idx_iv_vendor      ON erp_procurement.invoice_verification (vendor_id);
CREATE INDEX IF NOT EXISTS idx_iv_status      ON erp_procurement.invoice_verification (status);
CREATE INDEX IF NOT EXISTS idx_iv_po          ON erp_procurement.invoice_verification (po_id) WHERE po_id IS NOT NULL;

-- Blocked IV alert index (for Accounts dashboard — IVs needing resolution)
CREATE INDEX IF NOT EXISTS idx_iv_blocked
  ON erp_procurement.invoice_verification (company_id, created_at)
  WHERE status = 'BLOCKED';

CREATE INDEX IF NOT EXISTS idx_ivl_iv         ON erp_procurement.invoice_verification_line (iv_id);
CREATE INDEX IF NOT EXISTS idx_ivl_grn        ON erp_procurement.invoice_verification_line (grn_id);
CREATE INDEX IF NOT EXISTS idx_ivl_grn_line   ON erp_procurement.invoice_verification_line (grn_line_id);
CREATE INDEX IF NOT EXISTS idx_ivl_match      ON erp_procurement.invoice_verification_line (match_status);

-- Grants — all 8 tables
GRANT SELECT ON erp_procurement.return_to_vendor          TO authenticated;
GRANT SELECT ON erp_procurement.return_to_vendor_line     TO authenticated;
GRANT SELECT ON erp_procurement.debit_note                TO authenticated;
GRANT SELECT ON erp_procurement.exchange_reference        TO authenticated;
GRANT SELECT ON erp_procurement.landed_cost               TO authenticated;
GRANT SELECT ON erp_procurement.landed_cost_line          TO authenticated;
GRANT SELECT ON erp_procurement.invoice_verification      TO authenticated;
GRANT SELECT ON erp_procurement.invoice_verification_line TO authenticated;

GRANT ALL    ON erp_procurement.return_to_vendor          TO service_role;
GRANT ALL    ON erp_procurement.return_to_vendor_line     TO service_role;
GRANT ALL    ON erp_procurement.debit_note                TO service_role;
GRANT ALL    ON erp_procurement.exchange_reference        TO service_role;
GRANT ALL    ON erp_procurement.landed_cost               TO service_role;
GRANT ALL    ON erp_procurement.landed_cost_line          TO service_role;
GRANT ALL    ON erp_procurement.invoice_verification      TO service_role;
GRANT ALL    ON erp_procurement.invoice_verification_line TO service_role;

COMMIT;
```

---

## 4. Cross-Schema References (NO FK)

| Table | Column | References (logically) |
|---|---|---|
| return_to_vendor | company_id | erp_master.companies |
| return_to_vendor | vendor_id | erp_master.vendor_master |
| return_to_vendor_line | material_id | erp_master.material_master |
| return_to_vendor_line | storage_location_id | erp_inventory.storage_location_master |
| return_to_vendor_line | stock_document_id | erp_inventory.stock_document |
| return_to_vendor_line | stock_ledger_id | erp_inventory.stock_ledger |
| debit_note | company_id | erp_master.companies |
| debit_note | vendor_id | erp_master.vendor_master |
| exchange_reference | company_id | erp_master.companies |
| exchange_reference | vendor_id | erp_master.vendor_master |
| landed_cost | company_id | erp_master.companies |
| landed_cost | vendor_id | erp_master.vendor_master |
| landed_cost_line | cha_id | erp_master.cha_master |
| invoice_verification | company_id | erp_master.companies |
| invoice_verification | vendor_id | erp_master.vendor_master |
| invoice_verification_line | material_id | erp_master.material_master |

---

## 5. Critical Rules

| Rule | Detail |
|---|---|
| return_to_vendor_line.movement_type_code | Always P122. DEFAULT 'P122' with CHECK constraint |
| settlement_mode CHECK | IN ('DEBIT_NOTE','NEXT_INVOICE_ADJUST','EXCHANGE') |
| 50% tolerance hard block | Enforced by handler — match_status = BLOCKED when rate_variance_pct > 50 |
| debit_note auto-creation | Handler creates on RTV when settlement_mode = DEBIT_NOTE |
| exchange_reference auto-creation | Handler creates on RTV when settlement_mode = EXCHANGE |
| Partial return | return_qty ≤ original_grn_qty — enforced by handler, not DB |
| Landed Cost retroactive | No deadline — Accounts enters any time after GRN |
| gst_type = NONE | Import invoices — no GST; customs goes to Landed Cost |

---

## 6. Verification — Claude Will Check

1. `return_to_vendor` rtv_number UNIQUE, reason_category CHECK (6 values), settlement_mode CHECK (3 values), status CHECK (4 values)
2. `return_to_vendor_line` UNIQUE(rtv_id, line_number), movement_type_code DEFAULT 'P122' with CHECK
3. `return_to_vendor_line` stock_document_id + stock_ledger_id + storage_location_id — plain uuid NULL
4. `debit_note` dn_number UNIQUE, status CHECK (4 values: DRAFT/SENT/ACKNOWLEDGED/SETTLED), rtv_id intra-schema FK
5. `exchange_reference` exchange_ref_number UNIQUE, replacement_grn_id intra-schema FK (nullable), status CHECK (3 values)
6. `landed_cost` lc_number UNIQUE, grn_id + csn_id intra-schema FKs (both nullable), status CHECK (DRAFT/POSTED)
7. `landed_cost_line` UNIQUE(lc_id, line_number), cost_type CHECK (8 values)
8. `invoice_verification` iv_number UNIQUE, status CHECK (DRAFT/MATCHED/POSTED/BLOCKED)
9. `invoice_verification_line` UNIQUE(iv_id, line_number), match_status CHECK (3 values), gst_type CHECK (3 values)
10. `idx_iv_blocked` partial index WHERE status = 'BLOCKED'
11. GRANT SELECT authenticated on all 8 tables

---

*Spec frozen: 2026-05-11 | Reference: Sections 87.9, 98, 100*
