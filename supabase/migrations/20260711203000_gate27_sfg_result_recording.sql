/*
 * Migration: 20260711203000_gate27_sfg_result_recording
 * Gate: 27.16
 * Domain: PRODUCTION
 * Purpose: Add SFG QA document/test/decision tables as the Process-PO equivalent
 *          of Inward QA, plus the required SFG_QA document-number series row.
 * Authority: Backend
 */

BEGIN;

INSERT INTO erp_procurement.document_number_series (doc_type, pad_width, starting_number)
VALUES ('SFG_QA', 6, 950001)
ON CONFLICT (doc_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS erp_production.sfg_qa_document (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sfg_qa_number     text NOT NULL UNIQUE,
  qa_created_at     timestamptz NOT NULL DEFAULT now(),
  company_id        uuid NOT NULL,
  process_order_id  uuid NOT NULL
    REFERENCES erp_production.process_order(id)
    ON DELETE RESTRICT,
  material_id       uuid NOT NULL,
  batch_number      text NULL,
  qa_stock_qty      numeric(20, 6) NOT NULL CHECK (qa_stock_qty > 0),
  uom_code          text NOT NULL,
  status            text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'DECIDED')),
  assigned_to       uuid NULL,
  remarks           text NULL,
  last_updated_at   timestamptz NULL,
  last_updated_by   uuid NULL
);

COMMENT ON TABLE erp_production.sfg_qa_document IS
'SFG QA inspection lot. One per verified Process PO batch eligible for Gate-27.16 result recording. Partial decisions allowed via sfg_qa_decision_line.';

CREATE TABLE IF NOT EXISTS erp_production.sfg_qa_test_line (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qa_document_id   uuid NOT NULL
    REFERENCES erp_production.sfg_qa_document(id)
    ON DELETE RESTRICT,
  line_number      int NOT NULL,
  test_type        text NOT NULL
    CHECK (test_type IN ('VISUAL', 'MCT', 'LAB', 'OTHER')),
  test_parameter   text NOT NULL,
  test_result      text NULL,
  acceptable_range text NULL,
  pass_fail        text NOT NULL DEFAULT 'PENDING'
    CHECK (pass_fail IN ('PASS', 'FAIL', 'PENDING')),
  tested_by        uuid NULL,
  test_date        date NULL,
  remarks          text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  test_method_id   uuid NULL
    REFERENCES erp_master.qa_test_method(id)
    ON DELETE RESTRICT,
  lsl              numeric(20, 6) NULL,
  usl              numeric(20, 6) NULL,
  UNIQUE (qa_document_id, line_number)
);

COMMENT ON TABLE erp_production.sfg_qa_test_line IS
'SFG QA test results per inspection lot. Mirrors inward_qa_test_line for Process PO verify batches.';

COMMENT ON COLUMN erp_production.sfg_qa_test_line.test_method_id IS
'Links to erp_master.qa_test_method when the result was entered against a configured category method (MCT/OTHR redesign). NULL for legacy free-text VISUAL/LAB rows.';
COMMENT ON COLUMN erp_production.sfg_qa_test_line.lsl IS
'Snapshot of erp_master.qa_category_test_config.lsl at the time this result was entered.';
COMMENT ON COLUMN erp_production.sfg_qa_test_line.usl IS
'Snapshot of erp_master.qa_category_test_config.usl at the time this result was entered.';

CREATE TABLE IF NOT EXISTS erp_production.sfg_qa_decision_line (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qa_document_id       uuid NOT NULL
    REFERENCES erp_production.sfg_qa_document(id)
    ON DELETE RESTRICT,
  decision_line_number int NOT NULL,
  usage_decision       text NOT NULL
    CHECK (usage_decision IN ('RELEASE', 'BLOCK', 'REJECT', 'SCRAP', 'FOR_REPROCESS')),
  decision_qty         numeric(20, 6) NOT NULL CHECK (decision_qty > 0),
  movement_type_code   text NOT NULL
    CHECK (movement_type_code IN ('P321', 'P344', 'P553', 'FOR_REPROCESS')),
  posting_status       text NOT NULL DEFAULT 'PENDING'
    CHECK (posting_status IN ('PENDING', 'POSTED')),
  stock_document_id    uuid NULL,
  stock_ledger_id      uuid NULL,
  decided_by           uuid NOT NULL,
  decided_at           timestamptz NOT NULL DEFAULT now(),
  remarks              text NULL,
  storage_location_id  uuid NULL,
  UNIQUE (qa_document_id, decision_line_number)
);

COMMENT ON TABLE erp_production.sfg_qa_decision_line IS
'Recorded QA usage decision per verified Process PO batch. Mirrors inward_qa_decision_line, but Gate-27.16 records the result only and does not trigger a second stock posting.';

COMMENT ON COLUMN erp_production.sfg_qa_decision_line.storage_location_id IS
'Audit copy of the verified Process PO batch output storage location at decision time. Auto-derived by the handler - QA does not choose this.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sfg_qa_process_order
  ON erp_production.sfg_qa_document (process_order_id);
CREATE INDEX IF NOT EXISTS idx_sfg_qa_number
  ON erp_production.sfg_qa_document (sfg_qa_number);
CREATE INDEX IF NOT EXISTS idx_sfg_qa_company
  ON erp_production.sfg_qa_document (company_id);
CREATE INDEX IF NOT EXISTS idx_sfg_qa_material
  ON erp_production.sfg_qa_document (material_id);
CREATE INDEX IF NOT EXISTS idx_sfg_qa_status
  ON erp_production.sfg_qa_document (status);
CREATE INDEX IF NOT EXISTS idx_sfg_qa_assigned
  ON erp_production.sfg_qa_document (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sfg_qa_company_created
  ON erp_production.sfg_qa_document (company_id, qa_created_at)
  WHERE status IN ('PENDING', 'IN_PROGRESS');
CREATE INDEX IF NOT EXISTS idx_sfg_qatl_doc
  ON erp_production.sfg_qa_test_line (qa_document_id);
CREATE INDEX IF NOT EXISTS idx_sfg_qatl_method
  ON erp_production.sfg_qa_test_line (test_method_id) WHERE test_method_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sfg_qadl_doc
  ON erp_production.sfg_qa_decision_line (qa_document_id);
CREATE INDEX IF NOT EXISTS idx_sfg_qadl_status
  ON erp_production.sfg_qa_decision_line (posting_status);

GRANT SELECT ON erp_production.sfg_qa_document      TO authenticated;
GRANT SELECT ON erp_production.sfg_qa_test_line     TO authenticated;
GRANT SELECT ON erp_production.sfg_qa_decision_line TO authenticated;
GRANT ALL    ON erp_production.sfg_qa_document      TO service_role;
GRANT ALL    ON erp_production.sfg_qa_test_line     TO service_role;
GRANT ALL    ON erp_production.sfg_qa_decision_line TO service_role;

COMMIT;
