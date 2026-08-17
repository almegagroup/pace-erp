begin;

do $$
declare
  v_actor uuid;
  v_company record;
  v_old_acl_version_id uuid;
  v_new_acl_version_id uuid;
  v_user_wc record;
begin
  select uwc.auth_user_id
  into v_actor
  from erp_acl.user_work_contexts uwc
  join erp_acl.user_roles ur
    on ur.auth_user_id = uwc.auth_user_id
   and ur.role_code = 'DIRECTOR'
  join erp_acl.work_contexts wc
    on wc.work_context_id = uwc.work_context_id
   and wc.is_active = true
  where coalesce(wc.work_context_name, '') <> 'DIRECTOR-REPORTS'
  order by case when wc.work_context_name = 'DIRECTOR' then 0 else 1 end, uwc.auth_user_id
  limit 1;

  if v_actor is null then
    raise exception 'IN01 rollout blocked: no active non-report DIRECTOR context found for actor.';
  end if;

  insert into acl.resource_approval_policy (
    resource_code,
    action_code,
    approval_required,
    approval_type,
    min_approvers,
    max_approvers
  )
  values ('PROC_PI_LIST', 'APPROVE', true, 'ANYONE', 1, 3)
  on conflict (resource_code, action_code) do update
  set approval_required = excluded.approval_required,
      approval_type = excluded.approval_type,
      min_approvers = excluded.min_approvers,
      max_approvers = excluded.max_approvers;

  insert into acl.capabilities (
    capability_code,
    capability_name,
    description,
    is_system
  )
  values (
    'CAP_PI_AUDITOR',
    'Physical Inventory - Locked Access',
    'IN01 page + count/recount + post access for Director and Auditor roles only.',
    false
  )
  on conflict (capability_code) do update
  set capability_name = excluded.capability_name,
      description = excluded.description,
      is_system = excluded.is_system;

  insert into acl.role_capabilities (role_code, capability_code)
  select x.role_code, 'CAP_PI_AUDITOR'
  from (
    values
      ('DIRECTOR'),
      ('L1_AUDITOR'),
      ('L2_AUDITOR')
  ) as x(role_code)
  on conflict do nothing;

  insert into acl.capability_menu_actions (
    capability_code,
    menu_id,
    action,
    allowed,
    menu_visible
  )
  select
    'CAP_PI_AUDITOR',
    mm.id,
    x.action,
    true,
    x.menu_visible
  from acl.menu_master mm
  join (
    values
      ('PROC_PI_LIST', 'VIEW', true),
      ('PROC_PI_LIST', 'EDIT', true),
      ('PROC_PI_LIST', 'WRITE', true),
      ('PROC_PI_LIST', 'APPROVE', true),
      ('PROC_PI_COUNT_ENTRY', 'VIEW', true),
      ('PROC_PI_COUNT_ENTRY', 'WRITE', false),
      ('PROC_PI_RECOUNT', 'VIEW', true),
      ('PROC_PI_RECOUNT', 'WRITE', false)
  ) as x(menu_code, action, menu_visible)
    on x.menu_code = mm.menu_code
  on conflict (capability_code, menu_id, action) do update
  set allowed = excluded.allowed,
      menu_visible = excluded.menu_visible;

  for v_company in
    select c.id as company_id, c.company_code
    from erp_master.companies c
    where c.company_code in ('CMP003', 'CMP006')
    order by c.company_code
  loop
    delete from acl.work_context_capabilities
    where capability_code in ('CAP_PI_COUNT_ENTRY', 'CAP_PROC_INVENTORY', 'CAP_PI_AUDITOR')
      and work_context_id in (
        select wc.work_context_id
        from erp_acl.work_contexts wc
        where wc.company_id = v_company.company_id
      );

    insert into acl.work_context_capabilities (work_context_id, capability_code)
    select distinct
      uwc.work_context_id,
      'CAP_PI_AUDITOR'
    from erp_acl.user_work_contexts uwc
    join erp_acl.user_roles ur
      on ur.auth_user_id = uwc.auth_user_id
    join erp_acl.work_contexts wc
      on wc.work_context_id = uwc.work_context_id
     and wc.is_active = true
    where uwc.company_id = v_company.company_id
      and ur.role_code in ('DIRECTOR', 'L1_AUDITOR', 'L2_AUDITOR')
      and coalesce(wc.work_context_name, '') <> 'DIRECTOR-REPORTS'
    on conflict do nothing;

    delete from acl.approver_map
    where company_id = v_company.company_id
      and resource_code = 'PROC_PI_LIST'
      and action_code = 'APPROVE'
      and scope_type = 'SUBJECT_ROLE'
      and subject_role_code in ('L1_AUDITOR', 'L2_AUDITOR');

    insert into acl.approver_map (
      company_id,
      module_code,
      approval_stage,
      approver_role_code,
      approver_user_id,
      created_by,
      resource_code,
      action_code,
      scope_type,
      subject_user_id,
      subject_work_context_id,
      subject_role_code,
      approver_work_context_id
    )
    select
      v_company.company_id,
      mrm.module_code,
      1,
      src.approver_role_code,
      null,
      v_actor,
      'PROC_PI_LIST',
      'APPROVE',
      'SUBJECT_ROLE',
      null,
      null,
      src.subject_role_code,
      src.approver_work_context_id
    from acl.module_resource_map mrm
    join (
      select
        'L1_AUDITOR'::text as subject_role_code,
        'L2_AUDITOR'::text as approver_role_code,
        (
          select uwc.work_context_id
          from erp_acl.user_work_contexts uwc
          join erp_acl.user_roles ur
            on ur.auth_user_id = uwc.auth_user_id
           and ur.role_code = 'L2_AUDITOR'
          join erp_acl.work_contexts wc
            on wc.work_context_id = uwc.work_context_id
           and wc.company_id = v_company.company_id
           and wc.is_active = true
          order by uwc.work_context_id
          limit 1
        ) as approver_work_context_id
      union all
      select 'L1_AUDITOR'::text, 'DIRECTOR'::text, null::uuid
      union all
      select 'L2_AUDITOR'::text, 'DIRECTOR'::text, null::uuid
    ) src
      on true
    where mrm.resource_code = 'PROC_PI_LIST'
      and (
        src.approver_role_code <> 'L2_AUDITOR'
        or src.approver_work_context_id is not null
      )
    on conflict do nothing;

    select av.acl_version_id
    into v_old_acl_version_id
    from acl.acl_versions av
    where av.company_id = v_company.company_id
      and av.is_active = true
    order by av.version_number desc
    limit 1;

    if v_old_acl_version_id is null then
      raise exception 'IN01 rollout blocked: no active ACL version for company %', v_company.company_code;
    end if;

    update acl.acl_versions
    set is_active = false
    where company_id = v_company.company_id
      and is_active = true;

    insert into acl.acl_versions (
      company_id,
      version_number,
      description,
      is_active,
      created_by
    )
    select
      v_company.company_id,
      coalesce(max(av.version_number), 0) + 1,
      'IN01 locked to Director/L1 Auditor/L2 Auditor + approver_map approval chain',
      true,
      v_actor
    from acl.acl_versions av
    where av.company_id = v_company.company_id
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

    for v_user_wc in
      select distinct
        uwc.auth_user_id,
        uwc.work_context_id
      from erp_acl.user_work_contexts uwc
      join erp_acl.work_contexts wc
        on wc.work_context_id = uwc.work_context_id
       and wc.company_id = v_company.company_id
       and wc.is_active = true
      where uwc.company_id = v_company.company_id
    loop
      perform public.rebuild_acl_menu_snapshot(
        v_user_wc.auth_user_id,
        v_company.company_id,
        v_user_wc.work_context_id
      );
    end loop;
  end loop;
end;
$$;

commit;
