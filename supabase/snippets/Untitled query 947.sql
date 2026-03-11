SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    a.attname AS column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
    cls.relrowsecurity AS rls_enabled,
    i.relname AS index_name
FROM pg_class c
JOIN pg_namespace n
    ON n.oid = c.relnamespace
LEFT JOIN pg_attribute a
    ON a.attrelid = c.oid
LEFT JOIN pg_class cls
    ON cls.relname = c.relname
LEFT JOIN pg_index ix
    ON ix.indrelid = c.oid
LEFT JOIN pg_class i
    ON i.oid = ix.indexrelid
WHERE n.nspname = 'erp_audit'
  AND c.relname = 'admin_action_audit'
  AND a.attnum > 0
ORDER BY a.attnum;