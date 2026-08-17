select table_name, column_name
from information_schema.columns
where table_schema = 'erp_procurement'
  and table_name in ('planning_sloc_group', 'planning_sloc_group_member')
order by table_name, ordinal_position;
