begin;

do $$
declare
  v_actor uuid;
  v_company record;
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
    raise exception 'IN08/IN09 ACL correction blocked: no active non-report DIRECTOR context found for actor.';
  end if;

  insert into acl.capabilities (capability_code, capability_name, description, is_system)
  values
    ('CAP_PI_AUDITOR', 'Physical Inventory - Auditor Workspace', 'IN01 full access plus IN08/IN09 for Auditor and ACL-MASTER flows.', false),
    ('CAP_PI_COUNT_ENTRY', 'Physical Inventory - Count Entry', 'IN08/IN09 company-wide count entry and recount access except Director and L4 Manager.', false),
    ('CAP_PI_DIRECTOR', 'Physical Inventory - Director Workspace', 'IN01-only access for Director and ACL-MASTER, excluding count entry / recount.', false)
  on conflict (capability_code) do update
  set capability_name = excluded.capability_name,
      description = excluded.description,
      is_system = excluded.is_system;

  insert into acl.role_capabilities (role_code, capability_code)
  values
    ('DIRECTOR', 'CAP_PI_AUDITOR'),
    ('L1_AUDITOR', 'CAP_PI_AUDITOR'),
    ('L2_AUDITOR', 'CAP_PI_AUDITOR'),
    ('DIRECTOR', 'CAP_PI_DIRECTOR'),
    ('L1_AUDITOR', 'CAP_PI_COUNT_ENTRY'),
    ('L2_AUDITOR', 'CAP_PI_COUNT_ENTRY'),
    ('L1_MANAGER', 'CAP_PI_COUNT_ENTRY'),
    ('L1_USER', 'CAP_PI_COUNT_ENTRY'),
    ('L2_MANAGER', 'CAP_PI_COUNT_ENTRY'),
    ('L2_USER', 'CAP_PI_COUNT_ENTRY'),
    ('L3_MANAGER', 'CAP_PI_COUNT_ENTRY'),
    ('L3_USER', 'CAP_PI_COUNT_ENTRY'),
    ('L4_USER', 'CAP_PI_COUNT_ENTRY')
  on conflict do nothing;

  insert into acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)
  select x.capability_code, mm.id, x.action, true, x.menu_visible
  from acl.menu_master mm
  join (
    values
      ('CAP_PI_AUDITOR', 'PROC_PI_LIST', 'VIEW', true),
      ('CAP_PI_AUDITOR', 'PROC_PI_LIST', 'EDIT', true),
      ('CAP_PI_AUDITOR', 'PROC_PI_LIST', 'WRITE', true),
      ('CAP_PI_AUDITOR', 'PROC_PI_LIST', 'APPROVE', true),
      ('CAP_PI_AUDITOR', 'PROC_PI_COUNT_ENTRY', 'VIEW', true),
      ('CAP_PI_AUDITOR', 'PROC_PI_COUNT_ENTRY', 'WRITE', false),
      ('CAP_PI_AUDITOR', 'PROC_PI_RECOUNT', 'VIEW', true),
      ('CAP_PI_AUDITOR', 'PROC_PI_RECOUNT', 'WRITE', false),
      ('CAP_PI_DIRECTOR', 'PROC_PI_LIST', 'VIEW', true),
      ('CAP_PI_DIRECTOR', 'PROC_PI_LIST', 'EDIT', true),
      ('CAP_PI_DIRECTOR', 'PROC_PI_LIST', 'WRITE', true),
      ('CAP_PI_DIRECTOR', 'PROC_PI_LIST', 'APPROVE', true),
      ('CAP_PI_COUNT_ENTRY', 'PROC_PI_COUNT_ENTRY', 'VIEW', true),
      ('CAP_PI_COUNT_ENTRY', 'PROC_PI_COUNT_ENTRY', 'WRITE', false),
      ('CAP_PI_COUNT_ENTRY', 'PROC_PI_RECOUNT', 'VIEW', true),
      ('CAP_PI_COUNT_ENTRY', 'PROC_PI_RECOUNT', 'WRITE', false)
  ) as x(capability_code, menu_code, action, menu_visible)
    on x.menu_code = mm.menu_code
  on conflict (capability_code, menu_id, action) do update
  set allowed = excluded.allowed,
      menu_visible = excluded.menu_visible;

  delete from acl.capability_menu_actions
  where capability_code = 'CAP_PI_COUNT_ENTRY'
    and menu_id in (
      select id from acl.menu_master where menu_code = 'PROC_PI_LIST'
    );

  for v_company in
    select c.id as company_id, c.company_code
    from erp_master.companies c
    where c.company_code in ('CMP003', 'CMP006')
    order by c.company_code
  loop
    delete from acl.work_context_capabilities
    where capability_code in ('CAP_PI_AUDITOR', 'CAP_PI_COUNT_ENTRY', 'CAP_PI_DIRECTOR')
      and work_context_id in (
        select wc.work_context_id
        from erp_acl.work_contexts wc
        where wc.company_id = v_company.company_id
      );

    insert into acl.work_context_capabilities (work_context_id, capability_code)
    select distinct wc.work_context_id, 'CAP_PI_COUNT_ENTRY'
    from erp_acl.work_contexts wc
    where wc.company_id = v_company.company_id
      and wc.is_active = true
      and coalesce(wc.work_context_name, '') not in ('DIRECTOR', 'DIRECTOR-REPORTS', 'MANAGEMENT-REPORTS', 'ACL-MASTER')
    on conflict do nothing;

    insert into acl.work_context_capabilities (work_context_id, capability_code)
    select distinct uwc.work_context_id, 'CAP_PI_AUDITOR'
    from erp_acl.user_work_contexts uwc
    join erp_acl.user_roles ur
      on ur.auth_user_id = uwc.auth_user_id
    join erp_acl.work_contexts wc
      on wc.work_context_id = uwc.work_context_id
     and wc.is_active = true
    where uwc.company_id = v_company.company_id
      and (
        ur.role_code in ('L1_AUDITOR', 'L2_AUDITOR')
        or coalesce(wc.work_context_name, '') = 'ACL-MASTER'
      )
      and coalesce(wc.work_context_name, '') <> 'DIRECTOR-REPORTS'
    on conflict do nothing;

    insert into acl.work_context_capabilities (work_context_id, capability_code)
    select distinct uwc.work_context_id, 'CAP_PI_DIRECTOR'
    from erp_acl.user_work_contexts uwc
    join erp_acl.user_roles ur
      on ur.auth_user_id = uwc.auth_user_id
    join erp_acl.work_contexts wc
      on wc.work_context_id = uwc.work_context_id
     and wc.is_active = true
    where uwc.company_id = v_company.company_id
      and (
        coalesce(wc.work_context_name, '') in ('DIRECTOR', 'ACL-MASTER')
        or (
          ur.role_code = 'DIRECTOR'
          and coalesce(wc.work_context_name, '') <> 'DIRECTOR-REPORTS'
          and not exists (
            select 1
            from erp_acl.work_contexts wc2
            where wc2.company_id = v_company.company_id
              and wc2.is_active = true
              and wc2.work_context_name = 'DIRECTOR'
          )
        )
      )
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
      'IN08/IN09 corrected: company-wide count entry except Director/L4 Manager; IN01 remains Director/Auditor scoped',
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
