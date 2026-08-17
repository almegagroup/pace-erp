select
  u.user_code,
  c.company_code,
  c.company_name,
  ur.role_code,
  wc.work_context_code,
  wc.work_context_name
from erp_core.users u
join erp_map.user_companies uc
  on uc.auth_user_id = u.auth_user_id
join erp_master.companies c
  on c.id = uc.company_id
left join erp_acl.user_roles ur
  on ur.auth_user_id = u.auth_user_id
left join erp_acl.user_work_contexts uwc
  on uwc.auth_user_id = u.auth_user_id
 and uwc.company_id = c.id
left join erp_acl.work_contexts wc
  on wc.work_context_id = uwc.work_context_id
 and wc.is_active = true
where u.user_code in ('P0004', 'P0005', 'P0006')
order by u.user_code, c.company_code, wc.work_context_code nulls last;
