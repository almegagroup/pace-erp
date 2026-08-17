select
  'sloc_group' as row_type,
  g.id,
  g.group_name,
  g.active,
  c.company_code,
  null::text as storage_location_code,
  null::text as storage_location_name,
  null::text as item_group_name
from erp_procurement.planning_sloc_group g
join erp_master.companies c
  on c.id = g.company_id
where c.company_code = 'CMP003'

union all

select
  'member' as row_type,
  g.id,
  g.group_name,
  m.active,
  c.company_code,
  sl.code as storage_location_code,
  sl.name as storage_location_name,
  null::text as item_group_name
from erp_procurement.planning_sloc_group g
join erp_master.companies c
  on c.id = g.company_id
join erp_procurement.planning_sloc_group_member m
  on m.sloc_group_id = g.id
left join erp_inventory.storage_location_master sl
  on sl.id = m.storage_location_id
where c.company_code = 'CMP003'

union all

select
  'item_group' as row_type,
  g.id,
  g.group_name,
  ig.active,
  c.company_code,
  null::text as storage_location_code,
  null::text as storage_location_name,
  ig.group_name as item_group_name
from erp_procurement.planning_sloc_group g
join erp_master.companies c
  on c.id = g.company_id
join erp_procurement.planning_item_group ig
  on ig.sloc_group_id = g.id
where c.company_code = 'CMP003'

order by row_type, group_name, storage_location_code nulls first, item_group_name nulls first;
