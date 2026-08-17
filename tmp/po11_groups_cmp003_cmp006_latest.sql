with groups as (
  select c.company_code, g.id, g.group_name, g.active, g.created_at, g.last_updated_at
  from erp_procurement.planning_sloc_group g
  join erp_master.companies c on c.id = g.company_id
  where c.company_code in ('CMP003','CMP006')
), members as (
  select gm.sloc_group_id, sl.code as storage_code, sl.name as storage_name, sl.active as storage_active
  from erp_procurement.planning_sloc_group_member gm
  left join erp_inventory.storage_location_master sl on sl.id = gm.storage_location_id
)
select g.company_code, g.id, g.group_name, g.active, g.created_at, g.last_updated_at,
       m.storage_code, m.storage_name, m.storage_active
from groups g
left join members m on m.sloc_group_id = g.id
order by g.created_at desc, g.company_code, g.group_name, m.storage_code;
