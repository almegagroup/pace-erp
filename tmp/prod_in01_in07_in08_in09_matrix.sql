with target_users as (
  select *
  from (values
    ('CMP003', 'P0003'),
    ('CMP003', 'P0004'),
    ('CMP003', 'P0005'),
    ('CMP003', 'P0006'),
    ('CMP003', 'P0007'),
    ('CMP003', 'P0008'),
    ('CMP003', 'P0010'),
    ('CMP003', 'P0030'),
    ('CMP003', 'P0063'),
    ('CMP003', 'P0074'),
    ('CMP003', 'P0076'),
    ('CMP006', 'P0004'),
    ('CMP006', 'P0005'),
    ('CMP006', 'P0006'),
    ('CMP006', 'P0010'),
    ('CMP006', 'P0067'),
    ('CMP006', 'P0069'),
    ('CMP006', 'P0074'),
    ('CMP006', 'P0076')
  ) as t(company_code, user_code)
),
resolved as (
  select
    tu.company_code,
    tu.user_code,
    u.auth_user_id,
    c.id as company_id
  from target_users tu
  join erp_core.users u
    on u.user_code = tu.user_code
  join erp_master.companies c
    on c.company_code = tu.company_code
),
latest_menu as (
  select
    r.company_code,
    r.user_code,
    ur.role_code,
    wc.work_context_code,
    wc.work_context_name,
    ms.menu_code,
    ms.is_visible,
    row_number() over (
      partition by r.company_code, r.user_code, ms.work_context_id, ms.menu_code
      order by ms.snapshot_version desc, ms.created_at desc
    ) as rn
  from resolved r
  join erp_acl.user_roles ur
    on ur.auth_user_id = r.auth_user_id
  join erp_menu.menu_snapshot ms
    on ms.user_id = r.auth_user_id
   and ms.company_id = r.company_id
   and ms.universe = 'ACL'
  join erp_acl.work_contexts wc
    on wc.work_context_id = ms.work_context_id
  where ms.menu_code in ('PROC_PI_LIST', 'PROC_PI_DIFFERENCES', 'PROC_PI_COUNT_ENTRY', 'PROC_PI_RECOUNT')
)
select
  company_code,
  user_code,
  role_code,
  work_context_code,
  work_context_name,
  menu_code,
  is_visible
from latest_menu
where rn = 1
order by company_code, user_code, menu_code, work_context_code;
