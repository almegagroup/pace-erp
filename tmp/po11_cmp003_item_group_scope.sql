select
  c.company_code,
  ig.id,
  ig.group_name,
  ig.sloc_group_id,
  sg.group_name as sloc_group_name,
  ig.active,
  ig.created_at,
  count(pl.id) as linked_plan_rows
from erp_procurement.planning_item_group ig
join erp_master.companies c on c.id = ig.company_id
left join erp_procurement.planning_sloc_group sg on sg.id = ig.sloc_group_id
left join erp_procurement.procurement_monthly_plan_line pl on pl.planning_item_group_id = ig.id
where c.company_code = 'CMP003'
group by c.company_code, ig.id, ig.group_name, ig.sloc_group_id, sg.group_name, ig.active, ig.created_at
order by ig.created_at desc;
