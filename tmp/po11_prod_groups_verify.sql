select
  c.company_code,
  g.id,
  g.group_name,
  g.active,
  count(distinct gm.storage_location_id) filter (where gm.active = true) as sloc_count
from erp_procurement.planning_sloc_group g
join erp_master.companies c on c.id = g.company_id
left join erp_procurement.planning_sloc_group_member gm on gm.sloc_group_id = g.id
where c.company_code in ('CMP003', 'CMP006')
group by c.company_code, g.id, g.group_name, g.active
order by c.company_code, g.group_name;
