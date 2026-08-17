with company as (
  select id, company_code
  from erp_master.companies
  where company_code = 'CMP003'
),
active_item_group as (
  select count(*) as cnt
  from erp_procurement.planning_item_group ig
  join company c on c.id = ig.company_id
  where ig.active = true
),
active_sloc_group as (
  select count(*) as cnt
  from erp_procurement.planning_sloc_group sg
  join company c on c.id = sg.company_id
  where sg.active = true
),
active_sloc_members as (
  select count(*) as cnt
  from erp_procurement.planning_sloc_group_member m
  join erp_procurement.planning_sloc_group sg on sg.id = m.sloc_group_id and sg.active = true
  join company c on c.id = sg.company_id
  join erp_inventory.storage_location_master sl on sl.id = m.storage_location_id and sl.active = true
  where m.active = true
),
plant_ext_rows as (
  select count(*) as cnt
  from erp_master.material_plant_ext mpe
  join company c on c.id = mpe.company_id
  where mpe.status = 'ACTIVE'
),
rm_pm_plant_ext_rows as (
  select count(*) as cnt
  from erp_master.material_plant_ext mpe
  join company c on c.id = mpe.company_id
  join erp_master.material_master mm on mm.id = mpe.material_id and mm.material_type in ('RM', 'PM')
  where mpe.status = 'ACTIVE'
),
proc_allowed_rows as (
  select count(*) as cnt
  from erp_master.material_company_ext mce
  join company c on c.id = mce.company_id
  join erp_master.material_master mm on mm.id = mce.material_id and mm.material_type in ('RM', 'PM')
  where mce.status = 'ACTIVE'
    and mce.procurement_allowed = true
),
eligible_rows as (
  select count(distinct mpe.material_id) as cnt
  from erp_master.material_plant_ext mpe
  join company c on c.id = mpe.company_id
  join erp_master.material_master mm on mm.id = mpe.material_id and mm.material_type in ('RM', 'PM')
  join erp_master.material_company_ext mce
    on mce.company_id = mpe.company_id
   and mce.material_id = mpe.material_id
   and mce.status = 'ACTIVE'
   and mce.procurement_allowed = true
  join erp_procurement.planning_sloc_group_member m
    on m.storage_location_id = mpe.default_storage_location_id
   and m.active = true
  join erp_procurement.planning_sloc_group sg
    on sg.id = m.sloc_group_id
   and sg.company_id = mpe.company_id
   and sg.active = true
  join erp_inventory.storage_location_master sl
    on sl.id = mpe.default_storage_location_id
   and sl.active = true
  where mpe.status = 'ACTIVE'
)
select 'active_item_group' as metric, cnt from active_item_group
union all
select 'active_sloc_group', cnt from active_sloc_group
union all
select 'active_sloc_members', cnt from active_sloc_members
union all
select 'plant_ext_rows', cnt from plant_ext_rows
union all
select 'rm_pm_plant_ext_rows', cnt from rm_pm_plant_ext_rows
union all
select 'proc_allowed_rows', cnt from proc_allowed_rows
union all
select 'eligible_rows', cnt from eligible_rows;
