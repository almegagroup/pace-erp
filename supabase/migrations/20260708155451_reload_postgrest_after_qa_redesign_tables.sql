-- New tables (erp_master.qa_test_method, erp_master.qa_category_test_config) and the new
-- FK between them were added in the Inward QA redesign migrations just before this one.
-- PostgREST caches the schema and won't see new tables/relationships until reloaded —
-- this caused every qa-test-methods / qa-category-test-config request to 500 in dev.
-- MCP apply_migration goes through PgBouncer which blocks NOTIFY; supabase db push uses
-- a direct connection so NOTIFY reaches PostgREST (see 20260616000001 for precedent).

SELECT pg_notify('pgrst', 'reload schema');
