with target_users as (
  select *
  from (values
    ('P0003'),
    ('P0030')
  ) as t(user_code)
),
resolved_users as (
  select
    tu.user_code,
    u.auth_user_id
  from target_users tu
  join erp_core.users u
    on u.user_code = tu.user_code
),
active_version as (
  select av.company_id, av.acl_version_id
  from acl.acl_versions av
  join erp_master.companies c
    on c.id = av.company_id
  where av.is_active = true
    and c.company_code = 'CMP003'
)
select
  'SNAPSHOT' as section,
  ru.user_code,
  c.company_code,
  wc.work_context_code,
  pav.resource_code,
  pav.action_code,
  pav.decision as val1,
  coalesce(pav.menu_visible::text, '') as val2,
  coalesce(pav.decision_reason, '') as val3
from resolved_users ru
join erp_acl.user_work_contexts uwc
  on uwc.auth_user_id = ru.auth_user_id
join erp_acl.work_contexts wc
  on wc.work_context_id = uwc.work_context_id
 and wc.is_active = true
join erp_master.companies c
  on c.id = uwc.company_id
join active_version av
  on av.company_id = uwc.company_id
join acl.precomputed_acl_view pav
  on pav.acl_version_id = av.acl_version_id
 and pav.company_id = uwc.company_id
 and pav.auth_user_id = ru.auth_user_id
 and pav.work_context_id = uwc.work_context_id
where c.company_code = 'CMP003'
  and pav.resource_code in ('PROC_PI_COUNT_ENTRY', 'PROC_PI_RECOUNT')

union all

select
  'MENU' as section,
  ru.user_code,
  c.company_code,
  wc.work_context_code,
  ms.menu_code as resource_code,
  '' as action_code,
  ms.is_visible::text as val1,
  ms.snapshot_version::text as val2,
  coalesce(ms.route_path, '') as val3
from resolved_users ru
join erp_acl.user_work_contexts uwc
  on uwc.auth_user_id = ru.auth_user_id
join erp_acl.work_contexts wc
  on wc.work_context_id = uwc.work_context_id
 and wc.is_active = true
join erp_master.companies c
  on c.id = uwc.company_id
join erp_menu.menu_snapshot ms
  on ms.user_id = ru.auth_user_id
 and ms.company_id = uwc.company_id
 and ms.work_context_id = uwc.work_context_id
 and ms.universe = 'ACL'
where c.company_code = 'CMP003'
  and ms.menu_code in ('PROC_PI_COUNT_ENTRY', 'PROC_PI_RECOUNT')
order by user_code, section, resource_code, action_code;
