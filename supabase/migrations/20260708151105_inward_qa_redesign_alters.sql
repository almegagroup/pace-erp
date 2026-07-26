/*
 * File-Path: supabase/migrations/20260708151105_inward_qa_redesign_alters.sql
 * Domain: PROCUREMENT (Inward QA redesign)
 * Purpose: Link test lines to the new reusable Test Method master (with LSL/USL snapshot),
 *          and store the (auto-inherited, read-only) storage location on decision lines for
 *          audit — QA no longer supplies this manually, it is copied from the GRN line.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_procurement.inward_qa_test_line
  ADD COLUMN IF NOT EXISTS test_method_id uuid NULL
    REFERENCES erp_master.qa_test_method(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS lsl numeric(20, 6) NULL,
  ADD COLUMN IF NOT EXISTS usl numeric(20, 6) NULL;

COMMENT ON COLUMN erp_procurement.inward_qa_test_line.test_method_id IS
'Links to erp_master.qa_test_method when the result was entered against a configured category method (MCT/OTHR redesign). NULL for legacy free-text VISUAL/LAB rows.';
COMMENT ON COLUMN erp_procurement.inward_qa_test_line.lsl IS
'Snapshot of erp_master.qa_category_test_config.lsl at the time this result was entered.';
COMMENT ON COLUMN erp_procurement.inward_qa_test_line.usl IS
'Snapshot of erp_master.qa_category_test_config.usl at the time this result was entered.';

ALTER TABLE erp_procurement.inward_qa_decision_line
  ADD COLUMN IF NOT EXISTS storage_location_id uuid NULL;

COMMENT ON COLUMN erp_procurement.inward_qa_decision_line.storage_location_id IS
'Audit copy of the GRN line storage location at decision time. Auto-derived by the handler — QA does not choose this; usage decision reclassifies stock type only, it does not move the material to a different physical location.';

CREATE INDEX IF NOT EXISTS idx_qatl_method ON erp_procurement.inward_qa_test_line (test_method_id) WHERE test_method_id IS NOT NULL;

COMMIT;
