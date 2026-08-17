with target_plan as (
  select p.id, p.company_id, p.plan_month, p.status
  from erp_procurement.procurement_monthly_plan p
  join erp_master.companies c on c.id = p.company_id
  where c.company_code = 'CMP003'
    and p.plan_month = date '2026-08-01'
),
sloc_members as (
  select
    m.sloc_group_id,
    m.storage_location_id
  from erp_procurement.planning_sloc_group_member m
  join erp_inventory.storage_location_master sl
    on sl.id = m.storage_location_id
   and sl.active = true
  where m.active = true
),
eligible as (
  select distinct on (mpe.material_id)
    mpe.material_id,
    sm.sloc_group_id as eligible_sloc_group_id
  from target_plan tp
  join erp_master.material_plant_ext mpe
    on mpe.company_id = tp.company_id
   and mpe.status = 'ACTIVE'
  join erp_master.material_company_ext mce
    on mce.company_id = tp.company_id
   and mce.material_id = mpe.material_id
   and mce.status = 'ACTIVE'
   and mce.procurement_allowed = true
  join erp_master.material_master mm
    on mm.id = mpe.material_id
   and mm.material_type in ('RM', 'PM')
  left join sloc_members sm
    on sm.storage_location_id = mpe.default_storage_location_id
  order by mpe.material_id, sm.sloc_group_id nulls last
)
select
  mm.pace_code as material_code,
  mm.material_name,
  mm.material_type,
  l.source_sloc_group_id,
  sg.group_name as source_sloc_group_name,
  l.planning_item_group_id,
  ig.group_name as item_group_name,
  ig.sloc_group_id as item_group_parent_sloc_group_id,
  parent_sg.group_name as item_group_parent_sloc_group_name,
  e.eligible_sloc_group_id,
  elig_sg.group_name as eligible_sloc_group_name,
  case
    when l.id is null then 'NO_PLAN_LINE'
    when l.planning_item_group_id is null then 'UNGROUPED'
    else 'GROUPED'
  end as row_state
from eligible e
join erp_master.material_master mm
  on mm.id = e.material_id
left join target_plan tp
  on true
left join erp_procurement.procurement_monthly_plan_line l
  on l.plan_id = tp.id
 and l.material_id = e.material_id
left join erp_procurement.planning_sloc_group sg
  on sg.id = l.source_sloc_group_id
left join erp_procurement.planning_item_group ig
  on ig.id = l.planning_item_group_id
left join erp_procurement.planning_sloc_group parent_sg
  on parent_sg.id = ig.sloc_group_id
left join erp_procurement.planning_sloc_group elig_sg
  on elig_sg.id = e.eligible_sloc_group_id
order by
  case
    when l.id is null then 1
    when l.planning_item_group_id is null then 2
    else 3
  end,
  mm.pace_code;
