begin;

insert into acl.capabilities (
  capability_code,
  capability_name,
  description,
  is_system
)
values (
  'CAP_PROC_PLANNING_EDIT',
  'Procurement Planning Maintenance',
  'PO11 monthly procurement planning maintenance for SCM and Director only.',
  false
)
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  description = excluded.description;

insert into acl.capability_menu_actions (
  capability_code,
  menu_id,
  action,
  allowed,
  menu_visible
)
select
  'CAP_PROC_PLANNING_EDIT',
  am.id,
  'EDIT',
  true,
  true
from acl.menu_master am
where am.menu_code = 'PROC_PLANNING_VIEW'
on conflict (capability_code, menu_id, action)
do update
set
  allowed = excluded.allowed,
  menu_visible = excluded.menu_visible;

insert into acl.role_capabilities (
  role_code,
  capability_code
)
select roles.role_code, 'CAP_PROC_PLANNING_EDIT'
from (
  values
    ('DIRECTOR'),
    ('L1_MANAGER'),
    ('L2_USER'),
    ('L3_USER')
) as roles(role_code)
on conflict (role_code, capability_code) do nothing;

insert into acl.work_context_capabilities (
  work_context_id,
  capability_code
)
select wc.work_context_id, 'CAP_PROC_PLANNING_EDIT'
from erp_acl.work_contexts wc
join erp_master.companies c
  on c.id = wc.company_id
where (
    c.company_code = 'CMP003'
    and wc.work_context_code in ('DEPT_DPT018', 'DEPT_DPT024', 'DEPT_DPT030')
  )
  or (
    c.company_code = 'CMP006'
    and wc.work_context_code in ('DEPT_DPT007', 'DEPT_DPT027', 'DEPT_DPT031')
  )
on conflict (work_context_id, capability_code) do nothing;

do $$
declare
  v_actor uuid := '6570549f-a8fe-4146-a0bd-2c101ee43912';
  v_company record;
  v_new_acl_version_id uuid;
  v_snapshot_user record;
begin
  for v_company in
    select
      av.acl_version_id as old_acl_version_id,
      av.company_id,
      c.company_code,
      av.version_number + 1 as next_version_number
    from acl.acl_versions av
    join erp_master.companies c
      on c.id = av.company_id
    where av.is_active = true
      and c.company_code in ('CMP003', 'CMP006')
      and not exists (
        select 1
        from acl.version_capability_menu_actions vcma
        join acl.menu_master am
          on am.id = vcma.menu_id
        where vcma.acl_version_id = av.acl_version_id
          and am.menu_code = 'PROC_PLANNING_VIEW'
          and vcma.capability_code = 'CAP_PROC_PLANNING_EDIT'
          and vcma.action = 'EDIT'
          and vcma.allowed = true
      )
  loop
    update acl.acl_versions
    set is_active = false
    where acl_version_id = v_company.old_acl_version_id;

    insert into acl.acl_versions (
      company_id,
      version_number,
      description,
      is_active,
      created_by
    )
    values (
      v_company.company_id,
      v_company.next_version_number,
      'PO11 corrected authority: SCM + Director maintenance via PROC_PLANNING_VIEW EDIT',
      true,
      v_actor
    )
    returning acl_version_id
    into v_new_acl_version_id;

    perform acl.capture_acl_version_source(
      v_new_acl_version_id,
      v_company.company_id,
      v_actor
    );

    perform acl.generate_acl_snapshot(
      v_new_acl_version_id,
      v_company.company_id
    );

    delete from acl.precomputed_acl_view pav
    using acl.acl_versions av
    where pav.acl_version_id = av.acl_version_id
      and av.company_id = v_company.company_id
      and av.is_active is not true;

    for v_snapshot_user in
      select distinct
        uwc.auth_user_id,
        uwc.company_id,
        uwc.work_context_id
      from erp_acl.user_work_contexts uwc
      join erp_acl.work_contexts wc
        on wc.work_context_id = uwc.work_context_id
       and wc.is_active = true
      where uwc.company_id = v_company.company_id
    loop
      perform public.rebuild_acl_menu_snapshot(
        v_snapshot_user.auth_user_id,
        v_snapshot_user.company_id,
        v_snapshot_user.work_context_id
      );
    end loop;
  end loop;
end;
$$;

commit;
