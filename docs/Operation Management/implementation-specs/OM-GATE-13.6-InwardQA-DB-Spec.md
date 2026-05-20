# OM-GATE-13.6 — Inward QA DB Spec
# PACE-ERP Operation Management — erp_procurement

**Gate:** 13.6
**Phase:** Operation Management — Layer 2
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-13.5 VERIFIED ✅
**Design Reference:** Section 101

---

## 1. What You Are Building

Inward QA Document — auto-created per GRN line that lands in QA_STOCK.  
Test result lines + Usage Decision lines (partial decisions allowed).  
Movement types: P321 (release), P344 (block/reject), P553 (scrap).

---

## 2. Migration Files

---

### Migration 13.6.1 — Inward QA
**File:** `20260511060000_gate13_6_13_6_1_create_inward_qa.sql`

```sql
/*
 * File-ID: 13.6.1
 * File-Path: supabase/migrations/20260511060000_gate13_6_13_6_1_create_inward_qa.sql
 * Gate: 13.6
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Inward QA document + test lines + usage decision lines. Auto-created on GRN for QA_STOCK materials.
 * Authority: Backend
 */

BEGIN;

-- ── QA Document Header ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.inward_qa_document (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (QA series)
  qa_number           text NOT NULL UNIQUE,

  qa_created_at       timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema — plain uuid, NO FK
  company_id          uuid NOT NULL,
  plant_id            uuid NULL,

  -- Intra-schema FKs
  grn_id              uuid NOT NULL
    REFERENCES erp_procurement.goods_receipt(id)
    ON DELETE RESTRICT,

  grn_line_id         uuid NOT NULL
    REFERENCES erp_procurement.goods_receipt_line(id)
    ON DELETE RESTRICT,

  po_id               uuid NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  -- Cross-schema — plain uuid, NO FK
  material_id         uuid NOT NULL,
  vendor_id           uuid NULL,

  -- From GRN line
  batch_lot_number    text NULL,
  qa_stock_qty        numeric(20, 6) NOT NULL CHECK (qa_stock_qty > 0),
  uom_code            text NOT NULL,

  -- PENDING → IN_PROGRESS → DECIDED
  status              text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'DECIDED')),

  -- Assigned QA officer
  assigned_to         uuid NULL,

  remarks             text NULL,
  last_updated_at     timestamptz NULL,
  last_updated_by     uuid NULL
);

COMMENT ON TABLE erp_procurement.inward_qa_document IS
'Inward QA inspection lot. One per GRN line that lands in QA_STOCK. Auto-created by GRN posting handler. Partial decisions allowed via inward_qa_decision_line.';

-- ── QA Test Lines ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.inward_qa_test_line (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  qa_document_id  uuid NOT NULL
    REFERENCES erp_procurement.inward_qa_document(id)
    ON DELETE RESTRICT,

  line_number     int NOT NULL,

  -- VISUAL | MCT | LAB | OTHER
  test_type       text NOT NULL
    CHECK (test_type IN ('VISUAL', 'MCT', 'LAB', 'OTHER')),

  test_parameter  text NOT NULL,  -- e.g. Moisture Content, Colour, Odour
  test_result     text NULL,
  acceptable_range text NULL,     -- Reference from material spec

  -- PASS | FAIL | PENDING
  pass_fail       text NOT NULL DEFAULT 'PENDING'
    CHECK (pass_fail IN ('PASS', 'FAIL', 'PENDING')),

  tested_by       uuid NULL,
  test_date       date NULL,
  remarks         text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (qa_document_id, line_number)
);

COMMENT ON TABLE erp_procurement.inward_qa_test_line IS
'QA test results per inspection lot. VISUAL and MCT entered manually. LAB results entered manually in Phase-1 (lab integration is Phase-2).';

-- ── QA Usage Decision Lines ───────────────────────────────────────────────────
-- One QA document can have multiple decision lines (partial decisions — Section 101.4)
CREATE TABLE IF NOT EXISTS erp_procurement.inward_qa_decision_line (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  qa_document_id      uuid NOT NULL
    REFERENCES erp_procurement.inward_qa_document(id)
    ON DELETE RESTRICT,

  decision_line_number int NOT NULL,

  -- RELEASE | BLOCK | REJECT | SCRAP | FOR_REPROCESS
  usage_decision      text NOT NULL
    CHECK (usage_decision IN ('RELEASE', 'BLOCK', 'REJECT', 'SCRAP', 'FOR_REPROCESS')),

  -- Quantity for this decision (partial decision — sum of all lines = original qa_stock_qty)
  decision_qty        numeric(20, 6) NOT NULL CHECK (decision_qty > 0),

  -- Movement type posted for this decision
  -- P321: QA_STOCK → UNRESTRICTED (RELEASE)
  -- P344: QA_STOCK → BLOCKED (BLOCK or REJECT)
  -- P553: QA_STOCK → SCRAP (SCRAP)
  -- FOR_REPROCESS: role-restricted movement (handled by application)
  movement_type_code  text NOT NULL
    CHECK (movement_type_code IN ('P321', 'P344', 'P553', 'FOR_REPROCESS')),

  -- POSTED | PENDING
  posting_status      text NOT NULL DEFAULT 'PENDING'
    CHECK (posting_status IN ('PENDING', 'POSTED')),

  -- Cross-schema stock references — plain uuid, NO FK
  stock_document_id   uuid NULL,   -- → erp_inventory.stock_document
  stock_ledger_id     uuid NULL,   -- → erp_inventory.stock_ledger

  decided_by          uuid NOT NULL,
  decided_at          timestamptz NOT NULL DEFAULT now(),
  remarks             text NULL,

  UNIQUE (qa_document_id, decision_line_number)
);

COMMENT ON TABLE erp_procurement.inward_qa_decision_line IS
'Usage decision per inspection lot. Multiple lines allowed for partial decisions. Sum of decision_qty must equal qa_document.qa_stock_qty. REJECT → P344 (to BLOCKED) then RTV (P122) from RTV module.';

COMMIT;
```

---

### Migration 13.6.2 — QA Indexes
**File:** `20260511061000_gate13_6_13_6_2_create_qa_indexes.sql`

```sql
/*
 * File-ID: 13.6.2
 * File-Path: supabase/migrations/20260511061000_gate13_6_13_6_2_create_qa_indexes.sql
 * Gate: 13.6
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on inward QA tables.
 * Authority: Backend
 */

BEGIN;

CREATE INDEX IF NOT EXISTS idx_qa_number    ON erp_procurement.inward_qa_document (qa_number);
CREATE INDEX IF NOT EXISTS idx_qa_company   ON erp_procurement.inward_qa_document (company_id);
CREATE INDEX IF NOT EXISTS idx_qa_grn       ON erp_procurement.inward_qa_document (grn_id);
CREATE INDEX IF NOT EXISTS idx_qa_material  ON erp_procurement.inward_qa_document (material_id);
CREATE INDEX IF NOT EXISTS idx_qa_status    ON erp_procurement.inward_qa_document (status);
CREATE INDEX IF NOT EXISTS idx_qa_assigned  ON erp_procurement.inward_qa_document (assigned_to) WHERE assigned_to IS NOT NULL;

-- Pending QA documents (used by QA dashboard)
CREATE INDEX IF NOT EXISTS idx_qa_pending
  ON erp_procurement.inward_qa_document (company_id, qa_created_at)
  WHERE status IN ('PENDING', 'IN_PROGRESS');

CREATE INDEX IF NOT EXISTS idx_qatl_doc     ON erp_procurement.inward_qa_test_line (qa_document_id);
CREATE INDEX IF NOT EXISTS idx_qadl_doc     ON erp_procurement.inward_qa_decision_line (qa_document_id);
CREATE INDEX IF NOT EXISTS idx_qadl_status  ON erp_procurement.inward_qa_decision_line (posting_status);

GRANT SELECT ON erp_procurement.inward_qa_document      TO authenticated;
GRANT SELECT ON erp_procurement.inward_qa_test_line     TO authenticated;
GRANT SELECT ON erp_procurement.inward_qa_decision_line TO authenticated;
GRANT ALL    ON erp_procurement.inward_qa_document      TO service_role;
GRANT ALL    ON erp_procurement.inward_qa_test_line     TO service_role;
GRANT ALL    ON erp_procurement.inward_qa_decision_line TO service_role;

COMMIT;
```

---

## 3. Critical Rules

| Rule | Detail |
|---|---|
| usage_decision CHECK | IN ('RELEASE','BLOCK','REJECT','SCRAP','FOR_REPROCESS') |
| movement_type_code CHECK | IN ('P321','P344','P553','FOR_REPROCESS') |
| stock_document_id, stock_ledger_id | Plain uuid NULL (cross-schema to erp_inventory) |
| Partial decisions | Sum of decision_qty must = qa_stock_qty — enforced by handler, not DB |
| test_type CHECK | IN ('VISUAL','MCT','LAB','OTHER') |

---

*Spec frozen: 2026-05-11 | Reference: Section 101*
