with sloc_groups as (
  select
    g.id,
    g.company_id,
    g.group_name,
    g.active
  from erp_procurement.planning_sloc_group g
),
item_groups as (
  select
    ig.id,
    ig.company_id,
    ig.group_name,
    ig.sloc_group_id,
    sg.group_name as sloc_group_name,
    ig.active
  from erp_procurement.planning_item_group ig
  left join sloc_groups sg on sg.id = ig.sloc_group_id
),
active_sloc_members as (
  select
    m.sloc_group_id as planning_sloc_group_id,
    m.storage_location_id
  from erp_procurement.planning_sloc_group_member m
  join erp_inventory.storage_location_master sl
    on sl.id = m.storage_location_id
   and sl.active = true
),
eligible_materials as (
  select distinct on (mpe.material_id)
    mpe.company_id,
    mpe.material_id,
    aslm.planning_sloc_group_id as eligible_sloc_group_id
  from erp_master.material_plant_ext mpe
  join erp_master.material_master mm
    on mm.id = mpe.material_id
   and mm.material_type in ('RM', 'PM')
  join erp_master.material_company_ext mce
    on mce.company_id = mpe.company_id
   and mce.material_id = mpe.material_id
   and mce.status = 'ACTIVE'
   and mce.procurement_allowed = true
  left join active_sloc_members aslm
    on aslm.storage_location_id = mpe.default_storage_location_id
  where mpe.status = 'ACTIVE'
  order by mpe.material_id, aslm.planning_sloc_group_id nulls last
),
line_audit as (
  select
    p.company_id,
    p.plan_month,
    p.status as plan_status,
    l.id as line_id,
    l.material_id,
    mm.pace_code as material_code,
    mm.material_name,
    l.source_sloc_group_id,
    src.group_name as source_sloc_group_name,
    l.planning_item_group_id,
    ig.group_name as item_group_name,
    ig.sloc_group_id as item_group_parent_sloc_group_id,
    ig.sloc_group_name as item_group_parent_sloc_group_name,
    em.eligible_sloc_group_id,
    elig.group_name as eligible_sloc_group_name,
    case
      when l.planning_item_group_id is not null and l.source_sloc_group_id is null then 'GROUPED_BUT_SOURCE_NULL'
      when l.planning_item_group_id is not null and ig.id is null then 'GROUP_REF_MISSING'
      when l.planning_item_group_id is not null and ig.sloc_group_id is distinct from l.source_sloc_group_id then 'GROUP_PARENT_MISMATCH'
      when l.source_sloc_group_id is null and em.eligible_sloc_group_id is not null then 'ELIGIBLE_SOURCE_NOT_SYNCED'
      when l.source_sloc_group_id is distinct from em.eligible_sloc_group_id and em.eligible_sloc_group_id is not null then 'SOURCE_DIFFERS_FROM_ELIGIBLE'
      else null
    end as issue_code
  from erp_procurement.procurement_monthly_plan_line l
  join erp_procurement.procurement_monthly_plan p
    on p.id = l.plan_id
  left join erp_master.material_master mm
    on mm.id = l.material_id
  left join sloc_groups src
    on src.id = l.source_sloc_group_id
  left join item_groups ig
    on ig.id = l.planning_item_group_id
  left join eligible_materials em
    on em.company_id = l.company_id
   and em.material_id = l.material_id
  left join sloc_groups elig
    on elig.id = em.eligible_sloc_group_id
)
select
  company_id,
  plan_month,
  plan_status,
  issue_code,
  count(*) as affected_rows,
  string_agg(
    coalesce(material_code, material_id::text) || ' [' || coalesce(item_group_name, '-') || ']',
    ', '
    order by coalesce(material_code, material_id::text)
  ) as sample_materials
from line_audit
where issue_code is not null
group by company_id, plan_month, plan_status, issue_code
order by plan_month desc, company_id, issue_code;
