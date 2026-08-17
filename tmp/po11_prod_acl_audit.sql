with target_companies as (
  select id, company_code, company_name
  from erp_master.companies
  where company_code in ('CMP003', 'CMP006')
),
active_versions as (
  select av.company_id, av.acl_version_id, av.version_number, av.description, av.source_captured_at
  from acl.acl_versions av
  join target_companies tc on tc.id = av.company_id
  where av.is_active = true
),
resource_rows as (
  select
    tc.company_code,
    av.acl_version_id,
    av.version_number,
    am.menu_code,
    am.display_name,
    vcma.capability_code,
    vcma.action,
    vcma.allowed,
    vcma.menu_visible
  from active_versions av
  join target_companies tc on tc.id = av.company_id
  join acl.version_capability_menu_actions vcma on vcma.acl_version_id = av.acl_version_id
  join acl.menu_master am on am.id = vcma.menu_id
  where am.menu_code = 'PROC_PLANNING_VIEW'
),
wc_caps as (
  select
    tc.company_code,
    wc.work_context_id,
    wc.work_context_code,
    wc.work_context_name,
    wc.is_active,
    vwc.capability_code,
    av.version_number
  from active_versions av
  join target_companies tc on tc.id = av.company_id
  join acl.version_work_context_capabilities vwc on vwc.acl_version_id = av.acl_version_id
  join erp_acl.work_contexts wc on wc.work_context_id = vwc.work_context_id
  where vwc.capability_code in (
    select distinct capability_code
    from resource_rows
  )
),
user_contexts as (
  select
    tc.company_code,
    u.user_code,
    coalesce(
      nullif(trim(au.raw_user_meta_data->>'display_name'), ''),
      nullif(trim(au.raw_user_meta_data->>'name'), ''),
      nullif(trim(au.raw_user_meta_data->>'full_name'), '')
    ) as full_name,
    wc.work_context_code,
    wc.work_context_name,
    uwc.is_primary
  from erp_acl.user_work_contexts uwc
  join erp_core.users u on u.auth_user_id = uwc.auth_user_id
  left join auth.users au on au.id = u.auth_user_id
  join erp_acl.work_contexts wc on wc.work_context_id = uwc.work_context_id
  join target_companies tc on tc.id = uwc.company_id
  where wc.work_context_id in (
    select distinct work_context_id
    from wc_caps
  )
)
select 'RESOURCE_ACTIONS' as section, to_jsonb(t)
from (
  select *
  from resource_rows
  order by company_code, capability_code, action
) t

union all

select 'WORK_CONTEXT_CAPABILITIES' as section, to_jsonb(t)
from (
  select *
  from wc_caps
  order by company_code, work_context_code, capability_code
) t

union all

select 'USER_CONTEXTS' as section, to_jsonb(t)
from (
  select *
  from user_contexts
  order by company_code, work_context_code, user_code
) t;
