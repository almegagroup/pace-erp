select column_name
from information_schema.columns
where table_schema = 'erp_map'
  and table_name = 'user_companies'
order by ordinal_position;
