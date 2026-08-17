with company as (
  select id
  from erp_master.companies
  where company_code = 'CMP003'
),
group_locations as (
  select distinct
    sg.group_name,
    sl.id as storage_location_id,
    sl.code as storage_location_code,
    sl.name as storage_location_name
  from erp_procurement.planning_sloc_group sg
  join company c
    on c.id = sg.company_id
  join erp_procurement.planning_sloc_group_member m
    on m.sloc_group_id = sg.id
   and m.active = true
  join erp_inventory.storage_location_master sl
    on sl.id = m.storage_location_id
   and sl.active = true
  where sg.active = true
),
rm_pm_stock as (
  select
    ss.storage_location_id,
    mm.pace_code,
    mm.material_name,
    mm.material_type,
    sum(ss.quantity) as qty
  from erp_inventory.stock_snapshot ss
  join erp_master.material_master mm
    on mm.id = ss.material_id
   and mm.material_type in ('RM', 'PM')
  where ss.company_id = (select id from company)
    and ss.quantity > 0
  group by ss.storage_location_id, mm.pace_code, mm.material_name, mm.material_type
)
select
  gl.group_name,
  gl.storage_location_code,
  gl.storage_location_name,
  count(rs.pace_code) as rm_pm_stock_rows,
  string_agg(rs.pace_code, ', ' order by rs.pace_code) as sample_material_codes
from group_locations gl
left join rm_pm_stock rs
  on rs.storage_location_id = gl.storage_location_id
group by gl.group_name, gl.storage_location_code, gl.storage_location_name
order by gl.group_name, gl.storage_location_code;
