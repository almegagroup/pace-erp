-- Fix duplicate_index advisor findings (WARN) -- 3 pairs of literally
-- identical indexes, found live via pg_indexes grouped by normalized
-- definition. Each pair does the exact same job; keeping both only costs
-- extra storage and write overhead on every insert/update. Drop one from
-- each pair, keep the other.

BEGIN;

DROP INDEX IF EXISTS acl.idx_workflow_decisions_request;

ALTER TABLE erp_core.users DROP CONSTRAINT IF EXISTS users_auth_user_id_unique;

DROP INDEX IF EXISTS erp_master.uq_companies_gst_number;

COMMIT;
