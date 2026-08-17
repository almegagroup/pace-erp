with target_companies as (
  select id, company_code
  from erp_master.companies
  where company_code in ('CMP003', 'CMP006')
),
active_versions as (
  select acl_version_id, company_id, version_number
  from acl.acl_versions
  where is_active = true
    and company_id in (select id from target_companies)
),
resource_rows as (
  select
    tc.company_code,
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
  where am.menu_code = 'PROC_GATE_REPORT'
),
wc_caps as (
  select
    tc.company_code,
    wc.work_context_code,
    wc.work_context_name,
    vwc.capability_code
  from active_versions av
  join target_companies tc on tc.id = av.company_id
  join acl.version_work_context_capabilities vwc on vwc.acl_version_id = av.acl_version_id
  join erp_acl.work_contexts wc on wc.work_context_id = vwc.work_context_id
  where vwc.capability_code in (select distinct capability_code from resource_rows)
)
select 'RESOURCE' as section, to_jsonb(t)
from (select * from resource_rows order by company_code, capability_code, action) t
union all
select 'WORK_CONTEXT' as section, to_jsonb(t)
from (select * from wc_caps order by company_code, work_context_code, capability_code) t;
