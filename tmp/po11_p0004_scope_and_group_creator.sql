with p0004 as (
  select u.auth_user_id, u.user_code, u.full_name
  from erp_auth.users u
  where u.user_code = 'P0004'
), companies as (
  select c.company_code, uc.company_id
  from erp_map.user_companies uc
  join erp_master.companies c on c.id = uc.company_id
  join p0004 p on p.auth_user_id = uc.auth_user_id
), groups as (
  select c.company_code, g.group_name, g.created_by, g.created_at, g.last_updated_at
  from erp_procurement.planning_sloc_group g
  join erp_master.companies c on c.id = g.company_id
  where g.group_name in ('ACPL_ADMIX','ASCL_ADMIX')
)
select 'user_company' as kind, p.user_code, p.full_name, c.company_code, null::text as group_name, null::text as created_by, null::text as created_at, null::text as last_updated_at
from p0004 p
left join companies c on true
union all
select 'group_creator' as kind, null::text, null::text, g.company_code, g.group_name, g.created_by::text, g.created_at::text, g.last_updated_at::text
from groups g
order by kind, company_code;
