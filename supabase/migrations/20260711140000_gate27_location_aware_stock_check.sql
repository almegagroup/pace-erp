BEGIN;

-- Gate 27.14 is a code-path rearchitecture only.
-- No schema change is required because:
-- 1. erp_production.process_order_line.issue_sloc_id already exists.
-- 2. erp_production.reservation_document.storage_location_id already exists.
-- 3. production_segment_location_config must remain in place and untouched.

COMMIT;
