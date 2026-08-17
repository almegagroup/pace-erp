select table_schema, table_name
from information_schema.columns
where column_name in ('user_code','auth_user_id','full_name')
  and table_schema not in ('pg_catalog','information_schema')
order by table_schema, table_name;
