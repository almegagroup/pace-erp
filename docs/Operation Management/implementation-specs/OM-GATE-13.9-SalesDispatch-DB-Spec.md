# OM-GATE-13.9 — Sales / Dispatch (RM/PM Outward) DB Spec
# PACE-ERP Operation Management — erp_procurement

**Gate:** 13.9
**Phase:** Operation Management — Layer 2
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-13.8 VERIFIED ✅
**Design Reference:** Section 97, Section 99

---

## 1. What You Are Building

Sales Order (SO) for RM/PM outward sale to external customers.  
Sales Invoice (GST format) — created by Accounts after Delivery Challan.  
All in `erp_procurement` schema.

**Scope:** RM/PM outward only. FG dispatch is out of scope — separate Logistics module.

**Already exists — do NOT recreate:**
- `delivery_challan` + `delivery_challan_line` — in Gate-13.7 (dc_type = 'SALES' supported)
- `gate_exit_outbound` — in Gate-13.7 (exit_type = 'SALES' supported)

**Number series already seeded — do NOT add again:**
- 'SO' in `erp_procurement.document_number_series` — Gate-13.2.1
- `generate_invoice_number()` — Gate-13.2.1 (YYYYMM + incremental — Section 99.3)

---

## 2. Codex Instructions — Read This First

**File header:**
```sql
/*
 * File-ID: 13.9.X
 * File-Path: supabase/migrations/20260511HHMMSS_gate13_9_13_9_X_description.sql
 * Gate: 13.9
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: One sentence.
 * Authority: Backend
 */
```

**Cross-schema FK rule:** company_id, customer_id, material_id, issue_storage_location_id, payment_term_id — all plain uuid, NO REFERENCES.

**Intra-schema FKs allowed** — all tables in erp_procurement can reference each other.

---

## 3. Migration Files

---

### Migration 13.9.1 — Sales Order
**File:** `20260511090000_gate13_9_13_9_1_create_sales_order.sql`

```sql
/*
 * File-ID: 13.9.1
 * File-Path: supabase/migrations/20260511090000_gate13_9_13_9_1_create_sales_order.sql
 * Gate: 13.9
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Sales Order header + lines — RM/PM outward sale to external customers.
 * Authority: Backend
 */

BEGIN;

-- ── Sales Order Header ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.sales_order (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (SO series — Section 99.2)
  so_number             text NOT NULL UNIQUE,

  so_date               date NOT NULL,
  system_created_at     timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema — plain uuid, NO FK
  company_id            uuid NOT NULL,   -- → erp_master.companies (selling company)
  customer_id           uuid NOT NULL,   -- → erp_master.customer_master

  -- Customer's own purchase order reference (mandatory — Section 97.3)
  customer_po_number    text NOT NULL,
  customer_po_date      date NULL,

  -- Delivery address — defaults from Customer Master; overridable per SO
  delivery_address      text NULL,

  -- Payment Terms — dynamic last-used from Customer Master
  -- Plain uuid — cross-schema reference
  payment_term_id       uuid NULL,   -- → erp_master.payment_terms_master

  -- CREATED → ISSUED → INVOICED → CLOSED | CANCELLED
  -- ISSUED: at least one line partially dispatched
  -- INVOICED: all dispatched lines invoiced
  -- CLOSED: fully dispatched + invoiced, or manually closed (balance knocked off)
  status                text NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED', 'ISSUED', 'INVOICED', 'CLOSED', 'CANCELLED')),

  cancellation_reason   text NULL,
  cancelled_at          timestamptz NULL,
  cancelled_by          uuid NULL,

  remarks               text NULL,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_updated_at       timestamptz NULL,
  last_updated_by       uuid NULL
);

COMMENT ON TABLE erp_procurement.sales_order IS
'SO for RM/PM outward sale. Scope: RM/PM only (FG dispatch = separate Logistics module). Created when customer sends their PO. Partial dispatch allowed. Delivery Challan auto-created on stock issue. Sales Invoice raised by Accounts after DC.';

COMMENT ON COLUMN erp_procurement.sales_order.status IS
'CREATED: SO entered. ISSUED: at least one line dispatched (partial ok). INVOICED: all dispatched qty invoiced. CLOSED: fully done or balance knocked off.';

-- ── Sales Order Lines ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.sales_order_line (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK
  so_id                       uuid NOT NULL
    REFERENCES erp_procurement.sales_order(id)
    ON DELETE RESTRICT,

  line_number                 int NOT NULL,

  -- Cross-schema — plain uuid, NO FK
  material_id                 uuid NOT NULL,   -- → erp_master.material_master (RM/PM only — handler enforces)
  -- Issue storage location — cross-schema to erp_inventory
  issue_storage_location_id   uuid NULL,       -- → erp_inventory.storage_location_master

  quantity                    numeric(20, 6) NOT NULL CHECK (quantity > 0),
  uom_code                    text NOT NULL,

  -- Pricing (Section 97.3)
  rate                        numeric(20, 4) NOT NULL CHECK (rate > 0),
  discount_pct                numeric(6, 3) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  -- net_rate = rate × (1 − discount_pct/100) — computed by handler, stored
  net_rate                    numeric(20, 4) NOT NULL CHECK (net_rate > 0),

  -- GST (auto from Material Master; overridable per line)
  gst_rate                    numeric(6, 2) NULL CHECK (gst_rate >= 0),
  gst_amount                  numeric(20, 4) NULL CHECK (gst_amount >= 0),

  -- Total value = net_rate × quantity + gst_amount
  total_value                 numeric(20, 4) NULL CHECK (total_value >= 0),

  -- Dispatch tracking
  -- issued_qty: auto-updated by stock issue handler (can be partial)
  issued_qty                  numeric(20, 6) NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  -- balance_qty = quantity − issued_qty
  balance_qty                 numeric(20, 6) NOT NULL,

  -- Per-line status
  -- OPEN → PARTIALLY_ISSUED → FULLY_ISSUED | KNOCKED_OFF | CANCELLED
  line_status                 text NOT NULL DEFAULT 'OPEN'
    CHECK (line_status IN ('OPEN', 'PARTIALLY_ISSUED', 'FULLY_ISSUED', 'KNOCKED_OFF', 'CANCELLED')),

  knock_off_reason            text NULL,
  knocked_off_by              uuid NULL,
  knocked_off_at              timestamptz NULL,

  -- erp_inventory cross-schema references (plain uuid — no FK)
  -- Set after stock issue posting (SALES_ISSUE movement)
  stock_document_id           uuid NULL,   -- → erp_inventory.stock_document
  stock_ledger_id             uuid NULL,   -- → erp_inventory.stock_ledger

  created_at                  timestamptz NOT NULL DEFAULT now(),
  last_updated_at             timestamptz NULL,

  UNIQUE (so_id, line_number)
);

COMMENT ON TABLE erp_procurement.sales_order_line IS
'SO line. material_id must be RM or PM type (handler enforces — no DB constraint on material type). Partial dispatch: issued_qty updated per dispatch. balance_qty = quantity − issued_qty. stock_document_id set after SALES_ISSUE movement posting.';

COMMENT ON COLUMN erp_procurement.sales_order_line.issue_storage_location_id IS
'Location from which stock will be issued. Defaults from Material Master at SO creation. Overridable by Stores at dispatch. Cross-schema to erp_inventory — plain uuid.';

COMMIT;
```

---

### Migration 13.9.2 — Sales Invoice
**File:** `20260511091000_gate13_9_13_9_2_create_sales_invoice.sql`

```sql
/*
 * File-ID: 13.9.2
 * File-Path: supabase/migrations/20260511091000_gate13_9_13_9_2_create_sales_invoice.sql
 * Gate: 13.9
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: GST Sales Invoice — created by Accounts after Delivery Challan. YYYYMM+incremental number.
 * Authority: Backend
 */

BEGIN;

-- ── Sales Invoice Header ──────────────────────────────────────────────────────
-- Created by Accounts after DC. Cannot be created without a posted DC.
-- Number format: YYYYMM + incremental (Section 99.3) — uses generate_invoice_number()
CREATE TABLE IF NOT EXISTS erp_procurement.sales_invoice (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: YYYYMM + incremental global counter — Section 99.3
  invoice_number          text NOT NULL UNIQUE,

  invoice_date            date NOT NULL,
  system_created_at       timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema — plain uuid, NO FK
  company_id              uuid NOT NULL,   -- → erp_master.companies (selling company)
  customer_id             uuid NOT NULL,   -- → erp_master.customer_master

  -- Intra-schema FKs
  dc_id                   uuid NOT NULL
    REFERENCES erp_procurement.delivery_challan(id)
    ON DELETE RESTRICT,

  so_id                   uuid NULL
    REFERENCES erp_procurement.sales_order(id)
    ON DELETE RESTRICT,

  -- Payment Terms — carried from SO
  -- Plain uuid — cross-schema
  payment_term_id         uuid NULL,

  -- GST type at invoice level (same for all lines — derived from seller + buyer state)
  -- CGST_SGST: intra-state. IGST: inter-state.
  gst_type                text NOT NULL
    CHECK (gst_type IN ('CGST_SGST', 'IGST')),

  -- Totals (auto-computed from lines)
  total_taxable_value     numeric(20, 4) NULL CHECK (total_taxable_value >= 0),
  total_cgst_amount       numeric(20, 4) NULL CHECK (total_cgst_amount >= 0),
  total_sgst_amount       numeric(20, 4) NULL CHECK (total_sgst_amount >= 0),
  total_igst_amount       numeric(20, 4) NULL CHECK (total_igst_amount >= 0),
  total_gst_amount        numeric(20, 4) NULL CHECK (total_gst_amount >= 0),
  total_invoice_value     numeric(20, 4) NULL CHECK (total_invoice_value >= 0),

  -- DRAFT → POSTED
  status                  text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'POSTED')),

  posted_by               uuid NULL,
  posted_at               timestamptz NULL,

  remarks                 text NULL,
  created_by              uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  last_updated_at         timestamptz NULL
);

COMMENT ON TABLE erp_procurement.sales_invoice IS
'GST Sales Invoice for RM/PM outward. Created by Accounts after DC. Number: YYYYMM+incremental global (same counter as purchase invoices — Section 99.3). No GST portal integration in Phase-1. Format is GST-compliant for manual filing.';

COMMENT ON COLUMN erp_procurement.sales_invoice.invoice_number IS
'Format: YYYYMM + 6-digit incremental (e.g., 202607000001). Global counter shared across all invoice types. Never resets. Uses erp_procurement.generate_invoice_number().';

-- ── Sales Invoice Lines ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.sales_invoice_line (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK
  invoice_id        uuid NOT NULL
    REFERENCES erp_procurement.sales_invoice(id)
    ON DELETE RESTRICT,

  line_number       int NOT NULL,

  -- SO line reference (intra-schema)
  so_line_id        uuid NULL
    REFERENCES erp_procurement.sales_order_line(id)
    ON DELETE RESTRICT,

  -- DC line reference (intra-schema)
  dc_line_id        uuid NULL
    REFERENCES erp_procurement.delivery_challan_line(id)
    ON DELETE RESTRICT,

  -- Cross-schema — plain uuid, NO FK
  material_id       uuid NOT NULL,   -- → erp_master.material_master

  quantity          numeric(20, 6) NOT NULL CHECK (quantity > 0),
  uom_code          text NOT NULL,
  rate              numeric(20, 4) NOT NULL CHECK (rate > 0),
  taxable_value     numeric(20, 4) NOT NULL CHECK (taxable_value >= 0),

  -- GST per line (rate from Material Master / SO line)
  gst_rate          numeric(6, 2) NULL CHECK (gst_rate >= 0),

  -- CGST_SGST or IGST — matches invoice header gst_type
  cgst_amount       numeric(20, 4) NULL CHECK (cgst_amount >= 0),
  sgst_amount       numeric(20, 4) NULL CHECK (sgst_amount >= 0),
  igst_amount       numeric(20, 4) NULL CHECK (igst_amount >= 0),

  -- line_total = taxable_value + GST
  line_total        numeric(20, 4) NOT NULL CHECK (line_total >= 0),

  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (invoice_id, line_number)
);

COMMENT ON TABLE erp_procurement.sales_invoice_line IS
'Sales Invoice line. Loaded from DC lines. GST computed per line from Material Master GST rate. cgst_amount and sgst_amount populated for CGST_SGST; igst_amount populated for IGST. Others remain NULL.';

COMMIT;
```

---

### Migration 13.9.3 — Indexes + Grants
**File:** `20260511092000_gate13_9_13_9_3_create_indexes.sql`

```sql
/*
 * File-ID: 13.9.3
 * File-Path: supabase/migrations/20260511092000_gate13_9_13_9_3_create_indexes.sql
 * Gate: 13.9
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on sales_order, sales_order_line, sales_invoice, sales_invoice_line.
 * Authority: Backend
 */

BEGIN;

-- Sales Order indexes
CREATE INDEX IF NOT EXISTS idx_so_number      ON erp_procurement.sales_order (so_number);
CREATE INDEX IF NOT EXISTS idx_so_company     ON erp_procurement.sales_order (company_id);
CREATE INDEX IF NOT EXISTS idx_so_customer    ON erp_procurement.sales_order (customer_id);
CREATE INDEX IF NOT EXISTS idx_so_status      ON erp_procurement.sales_order (status);
CREATE INDEX IF NOT EXISTS idx_so_date        ON erp_procurement.sales_order (so_date);

CREATE INDEX IF NOT EXISTS idx_sol_so         ON erp_procurement.sales_order_line (so_id);
CREATE INDEX IF NOT EXISTS idx_sol_material   ON erp_procurement.sales_order_line (material_id);
CREATE INDEX IF NOT EXISTS idx_sol_status     ON erp_procurement.sales_order_line (line_status);

-- Open SO lines (for stock availability dashboard)
CREATE INDEX IF NOT EXISTS idx_sol_open
  ON erp_procurement.sales_order_line (so_id, line_status)
  WHERE line_status = 'OPEN';

-- Sales Invoice indexes
CREATE INDEX IF NOT EXISTS idx_si_number      ON erp_procurement.sales_invoice (invoice_number);
CREATE INDEX IF NOT EXISTS idx_si_company     ON erp_procurement.sales_invoice (company_id);
CREATE INDEX IF NOT EXISTS idx_si_customer    ON erp_procurement.sales_invoice (customer_id);
CREATE INDEX IF NOT EXISTS idx_si_dc          ON erp_procurement.sales_invoice (dc_id);
CREATE INDEX IF NOT EXISTS idx_si_so          ON erp_procurement.sales_invoice (so_id) WHERE so_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_si_status      ON erp_procurement.sales_invoice (status);
CREATE INDEX IF NOT EXISTS idx_si_date        ON erp_procurement.sales_invoice (invoice_date);

CREATE INDEX IF NOT EXISTS idx_sil_invoice    ON erp_procurement.sales_invoice_line (invoice_id);
CREATE INDEX IF NOT EXISTS idx_sil_so_line    ON erp_procurement.sales_invoice_line (so_line_id) WHERE so_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sil_dc_line    ON erp_procurement.sales_invoice_line (dc_line_id) WHERE dc_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sil_material   ON erp_procurement.sales_invoice_line (material_id);

-- Grants — all 4 tables
GRANT SELECT ON erp_procurement.sales_order          TO authenticated;
GRANT SELECT ON erp_procurement.sales_order_line     TO authenticated;
GRANT SELECT ON erp_procurement.sales_invoice        TO authenticated;
GRANT SELECT ON erp_procurement.sales_invoice_line   TO authenticated;

GRANT ALL    ON erp_procurement.sales_order          TO service_role;
GRANT ALL    ON erp_procurement.sales_order_line     TO service_role;
GRANT ALL    ON erp_procurement.sales_invoice        TO service_role;
GRANT ALL    ON erp_procurement.sales_invoice_line   TO service_role;

COMMIT;
```

---

## 4. Cross-Schema References (NO FK)

| Table | Column | References (logically) |
|---|---|---|
| sales_order | company_id | erp_master.companies |
| sales_order | customer_id | erp_master.customer_master |
| sales_order | payment_term_id | erp_master.payment_terms_master |
| sales_order_line | material_id | erp_master.material_master |
| sales_order_line | issue_storage_location_id | erp_inventory.storage_location_master |
| sales_order_line | stock_document_id | erp_inventory.stock_document |
| sales_order_line | stock_ledger_id | erp_inventory.stock_ledger |
| sales_invoice | company_id | erp_master.companies |
| sales_invoice | customer_id | erp_master.customer_master |
| sales_invoice | payment_term_id | erp_master.payment_terms_master |
| sales_invoice_line | material_id | erp_master.material_master |

---

## 5. Critical Rules

| Rule | Detail |
|---|---|
| SO number format | Global pure numeric (SO series) — uses `generate_doc_number('SO')` |
| Sales invoice number format | YYYYMM + incremental — uses `generate_invoice_number()` — Section 99.3 |
| DC + Gate Exit | Already in Gate-13.7. Do NOT recreate. |
| material_id RM/PM only | Handler enforces — no DB constraint on material type |
| gst_type on sales_invoice | CHECK IN ('CGST_SGST', 'IGST') — sales invoices always have GST (no NONE) |
| Partial dispatch | issued_qty < quantity → line_status = PARTIALLY_ISSUED |
| stock_document_id / stock_ledger_id | Plain uuid NULL — set after SALES_ISSUE movement |

---

## 6. Verification — Claude Will Check

1. `sales_order` so_number UNIQUE, status CHECK (5 values: CREATED/ISSUED/INVOICED/CLOSED/CANCELLED)
2. `sales_order_line` UNIQUE(so_id, line_number), discount_pct CHECK (0–100), balance_qty field present
3. `sales_order_line` stock_document_id + stock_ledger_id + issue_storage_location_id — plain uuid NULL
4. `sales_invoice` invoice_number UNIQUE, dc_id intra-schema FK NOT NULL, status CHECK (DRAFT/POSTED)
5. `sales_invoice` gst_type CHECK (CGST_SGST/IGST) — **no NONE** (unlike IV lines)
6. `sales_invoice_line` UNIQUE(invoice_id, line_number), so_line_id + dc_line_id — intra-schema FKs (nullable)
7. `idx_sol_open` partial index WHERE line_status = 'OPEN'
8. GRANT SELECT authenticated on all 4 tables

---

*Spec frozen: 2026-05-11 | Reference: Sections 97, 99*
