SELECT table_schema,
       table_name
FROM information_schema.tables
WHERE table_schema = 'erp_audit'
AND table_name = 'admin_action_audit';