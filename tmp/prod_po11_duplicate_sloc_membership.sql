select
  c.company_code,
  sl.code as storage_location_code,
  sl.name as storage_location_name,
  count(distinct sg.id) as active_group_count,
  string_agg(distinct sg.group_name, ', ' order by sg.group_name) as active_groups
from erp_procurement.planning_sloc_group_member m
join erp_procurement.planning_sloc_group sg
  on sg.id = m.sloc_group_id
 and sg.active = true
join erp_master.companies c
  on c.id = sg.company_id
join erp_inventory.storage_location_master sl
  on sl.id = m.storage_location_id
 and sl.active = true
where m.active = true
group by c.company_code, sl.code, sl.name
having count(distinct sg.id) > 1
order by c.company_code, sl.code;
