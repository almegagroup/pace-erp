with sloc_groups as (
  select c.company_code, g.id, g.group_name, g.company_id, g.active, g.created_at
  from erp_procurement.planning_sloc_group g
  join erp_master.companies c on c.id = g.company_id
  where c.company_code = 'CMP003'
), orphan_groups as (
  select id, group_name, company_id, active, created_at
  from erp_procurement.planning_sloc_group
  where company_id is null
), item_groups as (
  select c.company_code, ig.id, ig.group_name, ig.sloc_group_id, ig.company_id, ig.active, ig.created_at
  from erp_procurement.planning_item_group ig
  join erp_master.companies c on c.id = ig.company_id
  where c.company_code = 'CMP003'
)
select 'sloc_group' as kind, company_code, id, group_name, company_id::text as company_id, active::text as active, created_at::text as created_at, null::text as extra
from sloc_groups
union all
select 'item_group' as kind, company_code, id, group_name, company_id::text, active::text, created_at::text, sloc_group_id::text
from item_groups
union all
select 'orphan_sloc_group' as kind, null::text, id, group_name, company_id::text, active::text, created_at::text, null::text
from orphan_groups
order by kind, created_at desc;
