select
  c.company_code,
  p.plan_month,
  p.status as plan_status,
  sg.group_name as sloc_group_name,
  ig.group_name as item_group_name,
  count(l.id) as member_rows,
  string_agg(distinct mm.pace_code, ', ' order by mm.pace_code) as material_codes
from erp_procurement.procurement_monthly_plan p
join erp_master.companies c
  on c.id = p.company_id
left join erp_procurement.planning_item_group ig
  on ig.company_id = p.company_id
 and ig.active = true
left join erp_procurement.planning_sloc_group sg
  on sg.id = ig.sloc_group_id
left join erp_procurement.procurement_monthly_plan_line l
  on l.plan_id = p.id
 and l.planning_item_group_id = ig.id
left join erp_master.material_master mm
  on mm.id = l.material_id
where p.plan_month >= date '2026-06-01'
group by
  c.company_code,
  p.plan_month,
  p.status,
  sg.group_name,
  ig.group_name
order by
  p.plan_month desc,
  c.company_code,
  sg.group_name nulls last,
  ig.group_name nulls last;
