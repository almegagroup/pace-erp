begin;

with planning_menu as (
  select id
  from acl.menu_master
  where menu_code = 'PROC_PLANNING_VIEW'
)
insert into acl.capability_menu_actions (
  capability_code,
  menu_id,
  action,
  allowed,
  menu_visible
)
select
  'CAP_EVERYONE_REPORTS',
  pm.id,
  'VIEW',
  true,
  true
from planning_menu pm
on conflict (capability_code, menu_id, action)
do update
set
  allowed = excluded.allowed,
  menu_visible = excluded.menu_visible;

with target_companies as (
  select id
  from erp_master.companies
  where company_code in ('CMP003', 'CMP006')
),
planning_menu as (
  select id
  from acl.menu_master
  where menu_code = 'PROC_PLANNING_VIEW'
),
active_versions as (
  select acl_version_id
  from acl.acl_versions
  where is_active = true
    and company_id in (select id from target_companies)
)
insert into acl.version_capability_menu_actions (
  acl_version_id,
  capability_code,
  menu_id,
  action,
  allowed,
  menu_visible
)
select
  av.acl_version_id,
  'CAP_EVERYONE_REPORTS',
  pm.id,
  'VIEW',
  true,
  true
from active_versions av
cross join planning_menu pm
on conflict (acl_version_id, capability_code, menu_id, action)
do update
set
  allowed = excluded.allowed,
  menu_visible = excluded.menu_visible;

do $$
declare
  v_company record;
  v_user record;
begin
  for v_company in
    select av.acl_version_id, av.company_id
    from acl.acl_versions av
    join erp_master.companies c on c.id = av.company_id
    where av.is_active = true
      and c.company_code in ('CMP003', 'CMP006')
  loop
    perform acl.generate_acl_snapshot(v_company.acl_version_id, v_company.company_id);

    for v_user in
      select distinct
        uwc.auth_user_id,
        uwc.company_id,
        uwc.work_context_id
      from erp_acl.user_work_contexts uwc
      where uwc.company_id = v_company.company_id
    loop
      perform public.rebuild_acl_menu_snapshot(
        v_user.auth_user_id,
        v_user.company_id,
        v_user.work_context_id
      );
    end loop;
  end loop;
end;
$$;

commit;
