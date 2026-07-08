/*
 * File-Path: supabase/migrations/20260708151037_qa_test_method_master.sql
 * Domain: QUALITY (Inward QA redesign)
 * Purpose: Global, reusable Test Method pool per company + test group (MCT/OTHR).
 *          Same method (e.g. "pH") can be reused across multiple material categories
 *          instead of being re-typed — avoids duplication and spelling mistakes.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.qa_test_method (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cross-schema — plain uuid, NO FK
  company_id    uuid NOT NULL,

  test_group    text NOT NULL CHECK (test_group IN ('MCT', 'OTHR')),
  method_name   text NOT NULL,

  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, test_group, method_name)
);

COMMENT ON TABLE erp_master.qa_test_method IS
'Global reusable Inward QA test method pool, per company + test group (MCT/OTHR). Not category-bound — same method name is shared/reused across material categories via erp_master.qa_category_test_config, which holds the category-specific LSL/USL.';

CREATE INDEX IF NOT EXISTS idx_qa_test_method_company ON erp_master.qa_test_method (company_id, test_group);
CREATE INDEX IF NOT EXISTS idx_qa_test_method_active  ON erp_master.qa_test_method (is_active);

GRANT SELECT ON erp_master.qa_test_method TO authenticated;
GRANT ALL    ON erp_master.qa_test_method TO service_role;

COMMIT;
