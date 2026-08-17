with target_resources as (
  select unnest(array[
    'PROC_PI_LIST',
    'PROC_PI_COUNT_ENTRY',
    'PROC_PI_RECOUNT'
  ]) as resource_code
),
target_companies as (
  select c.id as company_id, c.company_code
  from erp_master.companies c
  where c.company_code in ('CMP003', 'CMP006')
)
select
  'ACTIVE_VERSIONS' as section,
  tc.company_code,
  av.acl_version_id::text as key1,
  av.version_number::text as key2,
  coalesce(av.description, '') as val1,
  av.is_active::text as val2
from target_companies tc
join acl.acl_versions av
  on av.company_id = tc.company_id
 and av.is_active = true

union all

select
  'APPROVAL_POLICY' as section,
  null as company_code,
  rap.resource_code as key1,
  rap.action_code as key2,
  concat('required=', rap.approval_required::text, ', type=', coalesce(rap.approval_type, '')) as val1,
  concat('min=', rap.min_approvers::text, ', max=', rap.max_approvers::text) as val2
from acl.resource_approval_policy rap
join target_resources tr
  on tr.resource_code = rap.resource_code
where rap.action_code = 'APPROVE'

union all

select
  'APPROVER_MAP' as section,
  tc.company_code,
  am.resource_code as key1,
  am.action_code as key2,
  concat(
    'scope=', coalesce(am.scope_type, ''),
    ', subject_role=', coalesce(am.subject_role_code, ''),
    ', approver_role=', coalesce(am.approver_role_code, ''),
    ', stage=', am.approval_stage::text
  ) as val1,
  coalesce(am.approver_work_context_id::text, '') as val2
from acl.approver_map am
join target_companies tc
  on tc.company_id = am.company_id
where am.resource_code = 'PROC_PI_LIST'
  and am.action_code = 'APPROVE'

union all

select
  'CAP_MENU' as section,
  null as company_code,
  cma.capability_code as key1,
  concat(tr.resource_code, ':', cma.action) as key2,
  concat('allowed=', cma.allowed::text) as val1,
  concat('menu_visible=', cma.menu_visible::text) as val2
from acl.capability_menu_actions cma
join acl.menu_master mm
  on mm.id = cma.menu_id
join target_resources tr
  on tr.resource_code = mm.menu_code

union all

select
  'ROLE_CAP' as section,
  null as company_code,
  rc.role_code as key1,
  rc.capability_code as key2,
  '' as val1,
  '' as val2
from acl.role_capabilities rc
where rc.capability_code in (
  select distinct cma.capability_code
  from acl.capability_menu_actions cma
  join acl.menu_master mm
    on mm.id = cma.menu_id
  join target_resources tr
    on tr.resource_code = mm.menu_code
)

union all

select
  'WC_CAP' as section,
  tc.company_code,
  wc.work_context_code as key1,
  wcc.capability_code as key2,
  coalesce(wc.work_context_name, '') as val1,
  coalesce(d.department_code, '') as val2
from acl.work_context_capabilities wcc
join erp_acl.work_contexts wc
  on wc.work_context_id = wcc.work_context_id
join target_companies tc
  on tc.company_id = wc.company_id
left join erp_master.departments d
  on d.id = wc.department_id
where wcc.capability_code in (
  select distinct cma.capability_code
  from acl.capability_menu_actions cma
  join acl.menu_master mm
    on mm.id = cma.menu_id
  join target_resources tr
    on tr.resource_code = mm.menu_code
)
order by section, company_code nulls first, key1, key2;
