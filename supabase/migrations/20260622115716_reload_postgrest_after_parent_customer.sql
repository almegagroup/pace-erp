-- MCP apply_migration goes through PgBouncer which blocks NOTIFY, so the
-- new parent_customer_master/customer_master columns and the
-- generate_parent_customer_code() RPC weren't visible to PostgREST's
-- cached schema until this ran. supabase db push uses a direct connection
-- so this NOTIFY reaches PostgREST automatically there.
SELECT pg_notify('pgrst', 'reload schema');
