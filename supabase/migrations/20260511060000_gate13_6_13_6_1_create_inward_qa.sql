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

-- QA Document Header
CREATE TABLE IF NOT EXISTS erp_procurement.inward_qa_document (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (QA series)
  qa_number           text NOT NULL UNIQUE,

  qa_created_at       timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema - plain uuid, NO FK
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

  -- Cross-schema - plain uuid, NO FK
  material_id         uuid NOT NULL,
  vendor_id           uuid NULL,

  -- From GRN line
  batch_lot_number    text NULL,
  qa_stock_qty        numeric(20, 6) NOT NULL CHECK (qa_stock_qty > 0),
  uom_code            text NOT NULL,

  -- PENDING -> IN_PROGRESS -> DECIDED
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

-- QA Test Lines
CREATE TABLE IF NOT EXISTS erp_procurement.inward_qa_test_line (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  qa_document_id   uuid NOT NULL
    REFERENCES erp_procurement.inward_qa_document(id)
    ON DELETE RESTRICT,

  line_number      int NOT NULL,

  -- VISUAL | MCT | LAB | OTHER
  test_type        text NOT NULL
    CHECK (test_type IN ('VISUAL', 'MCT', 'LAB', 'OTHER')),

  test_parameter   text NOT NULL,
  test_result      text NULL,
  acceptable_range text NULL,

  -- PASS | FAIL | PENDING
  pass_fail        text NOT NULL DEFAULT 'PENDING'
    CHECK (pass_fail IN ('PASS', 'FAIL', 'PENDING')),

  tested_by        uuid NULL,
  test_date        date NULL,
  remarks          text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (qa_document_id, line_number)
);

COMMENT ON TABLE erp_procurement.inward_qa_test_line IS
'QA test results per inspection lot. VISUAL and MCT entered manually. LAB results entered manually in Phase-1 (lab integration is Phase-2).';

-- QA Usage Decision Lines
-- One QA document can have multiple decision lines (partial decisions - Section 101.4)
CREATE TABLE IF NOT EXISTS erp_procurement.inward_qa_decision_line (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  qa_document_id       uuid NOT NULL
    REFERENCES erp_procurement.inward_qa_document(id)
    ON DELETE RESTRICT,

  decision_line_number int NOT NULL,

  -- RELEASE | BLOCK | REJECT | SCRAP | FOR_REPROCESS
  usage_decision       text NOT NULL
    CHECK (usage_decision IN ('RELEASE', 'BLOCK', 'REJECT', 'SCRAP', 'FOR_REPROCESS')),

  -- Quantity for this decision (partial decision - sum of all lines = original qa_stock_qty)
  decision_qty         numeric(20, 6) NOT NULL CHECK (decision_qty > 0),

  -- Movement type posted for this decision
  -- P321: QA_STOCK -> UNRESTRICTED (RELEASE)
  -- P344: QA_STOCK -> BLOCKED (BLOCK or REJECT)
  -- P553: QA_STOCK -> SCRAP (SCRAP)
  -- FOR_REPROCESS: role-restricted movement (handled by application)
  movement_type_code   text NOT NULL
    CHECK (movement_type_code IN ('P321', 'P344', 'P553', 'FOR_REPROCESS')),

  -- POSTED | PENDING
  posting_status       text NOT NULL DEFAULT 'PENDING'
    CHECK (posting_status IN ('PENDING', 'POSTED')),

  -- Cross-schema stock references - plain uuid, NO FK
  stock_document_id    uuid NULL,
  stock_ledger_id      uuid NULL,

  decided_by           uuid NOT NULL,
  decided_at           timestamptz NOT NULL DEFAULT now(),
  remarks              text NULL,

  UNIQUE (qa_document_id, decision_line_number)
);

COMMENT ON TABLE erp_procurement.inward_qa_decision_line IS
'Usage decision per inspection lot. Multiple lines allowed for partial decisions. Sum of decision_qty must equal qa_document.qa_stock_qty. REJECT -> P344 (to BLOCKED) then RTV (P122) from RTV module.';

COMMIT;
