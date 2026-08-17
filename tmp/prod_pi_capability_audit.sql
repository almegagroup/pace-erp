with target_caps as (
  select *
  from (values
    ('CAP_PI_AUDITOR'),
    ('CAP_PI_COUNT_ENTRY'),
    ('CAP_PI_DIRECTOR')
  ) as t(capability_code)
)
select
  'ROLE_CAP' as section,
  rc.capability_code,
  rc.role_code,
  null::text as company_code,
  null::text as work_context_code,
  null::text as work_context_name,
  null::text as menu_code,
  null::text as action_code,
  null::text as menu_visible
from acl.role_capabilities rc
join target_caps tc
  on tc.capability_code = rc.capability_code

union all

select
  'MENU_ACTION' as section,
  cma.capability_code,
  null::text as role_code,
  null::text as company_code,
  null::text as work_context_code,
  null::text as work_context_name,
  mm.menu_code,
  cma.action,
  cma.menu_visible::text
from acl.capability_menu_actions cma
join target_caps tc
  on tc.capability_code = cma.capability_code
join acl.menu_master mm
  on mm.id = cma.menu_id

union all

select
  'WC_CAP' as section,
  wcc.capability_code,
  null::text as role_code,
  c.company_code,
  wc.work_context_code,
  wc.work_context_name,
  null::text as menu_code,
  null::text as action_code,
  null::text as menu_visible
from acl.work_context_capabilities wcc
join target_caps tc
  on tc.capability_code = wcc.capability_code
join erp_acl.work_contexts wc
  on wc.work_context_id = wcc.work_context_id
join erp_master.companies c
  on c.id = wc.company_id
where c.company_code in ('CMP003', 'CMP006')
order by section, capability_code, role_code nulls last, company_code nulls last, work_context_code nulls last, menu_code nulls last, action_code nulls last;
