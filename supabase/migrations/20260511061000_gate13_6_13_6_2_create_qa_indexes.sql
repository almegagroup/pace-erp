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
