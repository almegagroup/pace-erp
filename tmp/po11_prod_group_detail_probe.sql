select
  g.id as sloc_group_id,
  g.group_name,
  g.company_id,
  c.company_code,
  g.active,
  g.created_at,
  g.last_updated_at,
  sl.code as storage_location_code,
  sl.name as storage_location_name,
  ig.id as item_group_id,
  ig.group_name as item_group_name,
  ig.active as item_group_active
from erp_procurement.planning_sloc_group g
left join erp_master.companies c
  on c.id = g.company_id
left join erp_procurement.planning_sloc_group_member m
  on m.sloc_group_id = g.id
 and m.active = true
left join erp_inventory.storage_location_master sl
  on sl.id = m.storage_location_id
left join erp_procurement.planning_item_group ig
  on ig.sloc_group_id = g.id
 and ig.active = true
where g.company_id = (
  select id from erp_master.companies where company_code = 'CMP003' limit 1
)
order by g.group_name, sl.code nulls last, ig.group_name nulls last;
