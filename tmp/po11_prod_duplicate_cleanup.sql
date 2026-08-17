begin;

with target_groups as (
  select *
  from (
    values
      ('ddf0e3f5-68a7-410e-8f8a-ecdc3aa3ba2a'::uuid, 'ADM_HPS'),
      ('0300ee9a-951b-41cf-9699-ba2aadbc2442'::uuid, 'ADM_HPS PLANNING')
  ) as v(id, expected_name)
),
validated_targets as (
  select g.id, g.group_name
  from erp_procurement.planning_sloc_group g
  join target_groups t
    on t.id = g.id
   and t.expected_name = g.group_name
  where g.active = true
    and g.company_id = (
      select id
      from erp_master.companies
      where company_code = 'CMP003'
      limit 1
    )
    and not exists (
      select 1
      from erp_procurement.planning_item_group ig
      where ig.sloc_group_id = g.id
        and ig.active = true
    )
    and not exists (
      select 1
      from erp_procurement.procurement_monthly_plan_line pll
      where pll.source_sloc_group_id = g.id
    )
),
deactivated_members as (
  update erp_procurement.planning_sloc_group_member m
     set active = false
   where m.sloc_group_id in (select id from validated_targets)
     and m.active = true
  returning m.sloc_group_id, m.storage_location_id
),
deactivated_groups as (
  update erp_procurement.planning_sloc_group g
     set active = false
   where g.id in (select id from validated_targets)
     and g.active = true
  returning g.id, g.group_name
)
select
  (select count(*) from validated_targets) as validated_target_count,
  (select count(*) from deactivated_groups) as deactivated_group_count,
  (select count(*) from deactivated_members) as deactivated_member_count,
  coalesce(
    (
      select json_agg(row_to_json(x))
      from (
        select id, group_name
        from deactivated_groups
        order by group_name
      ) x
    ),
    '[]'::json
  ) as deactivated_groups;

commit;
