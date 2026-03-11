SELECT
    t.table_schema,
    t.table_name,
    c.column_name,
    c.data_type,
    cls.relrowsecurity AS rls_enabled
FROM information_schema.tables t
LEFT JOIN information_schema.columns c
       ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
LEFT JOIN pg_class cls
       ON cls.relname = t.table_name
WHERE t.table_schema = 'erp_audit'
  AND t.table_name = 'admin_action_audit'
ORDER BY c.ordinal_position;