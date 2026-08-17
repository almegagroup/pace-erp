select column_name
from information_schema.columns
where table_schema = 'acl'
  and table_name = 'menu_master'
order by ordinal_position;
