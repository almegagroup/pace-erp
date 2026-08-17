select
  c.company_code,
  p.plan_month,
  p.status as plan_status,
  count(*) as total_plan_lines,
  count(*) filter (where l.source_sloc_group_id is not null) as with_source_sloc_group,
  count(*) filter (where l.planning_item_group_id is not null) as with_item_group,
  string_agg(mm.pace_code, ', ' order by mm.pace_code) as material_codes
from erp_procurement.procurement_monthly_plan p
join erp_master.companies c
  on c.id = p.company_id
join erp_procurement.procurement_monthly_plan_line l
  on l.plan_id = p.id
left join erp_master.material_master mm
  on mm.id = l.material_id
where c.company_code = 'CMP003'
  and p.plan_month = date '2026-08-01'
group by c.company_code, p.plan_month, p.status;
