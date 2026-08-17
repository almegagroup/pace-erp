with target_users as (
  select *
  from (values
    ('CMP003', 'P0004'),
    ('CMP003', 'P0007'),
    ('CMP003', 'P0063'),
    ('CMP003', 'P0076'),
    ('CMP006', 'P0004'),
    ('CMP006', 'P0067'),
    ('CMP006', 'P0076')
  ) as t(company_code, user_code)
),
resolved_users as (
  select
    tu.company_code,
    tu.user_code,
    u.auth_user_id,
    co.id as company_id,
    co.company_name
  from target_users tu
  join erp_core.users u on u.user_code = tu.user_code
  join erp_master.companies co on co.company_code = tu.company_code
),
po11_acl as (
  select
    ru.company_code,
    ru.user_code,
    wc.work_context_code,
    pav.action_code,
    pav.decision
  from resolved_users ru
  join acl.precomputed_acl_view pav
    on pav.auth_user_id = ru.auth_user_id
   and pav.company_id = ru.company_id
  join acl.acl_versions av
    on av.acl_version_id = pav.acl_version_id
   and av.is_active = true
  join erp_acl.work_contexts wc
    on wc.work_context_id = pav.work_context_id
  where pav.resource_code = 'PROC_PLANNING_VIEW'
),
po11_menu as (
  select
    x.company_code,
    x.user_code,
    x.work_context_code,
    x.is_visible,
    x.snapshot_version
  from (
    select
      ru.company_code,
      ru.user_code,
      wc.work_context_code,
      ms.is_visible,
      ms.snapshot_version,
      row_number() over (
        partition by ru.company_code, ru.user_code, ms.work_context_id, ms.menu_code
        order by ms.snapshot_version desc, ms.created_at desc
      ) as rn
    from resolved_users ru
    join erp_menu.menu_snapshot ms
      on ms.user_id = ru.auth_user_id
     and ms.company_id = ru.company_id
     and ms.menu_code = 'PROC_PLANNING_VIEW'
     and ms.universe = 'ACL'
    join erp_acl.work_contexts wc
      on wc.work_context_id = ms.work_context_id
  ) x
  where x.rn = 1
)
select 'ACL' as section, to_jsonb(t)
from (
  select *
  from po11_acl
  order by company_code, user_code, work_context_code, action_code
) t
union all
select 'MENU' as section, to_jsonb(t)
from (
  select *
  from po11_menu
  order by company_code, user_code, work_context_code
) t;
