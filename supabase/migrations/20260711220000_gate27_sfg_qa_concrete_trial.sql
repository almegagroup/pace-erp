BEGIN;

ALTER TABLE erp_master.qa_test_method DROP CONSTRAINT IF EXISTS qa_test_method_test_group_check;
ALTER TABLE erp_master.qa_test_method ADD CONSTRAINT qa_test_method_test_group_check
  CHECK (test_group = ANY (ARRAY['MCT','OTHR','CT']));

COMMIT;
