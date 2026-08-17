with duplicate_memberships as (
  select
    g.company_id,
    c.company_code,
    m.storage_location_id,
    sl.code as storage_location_code,
    sl.name as storage_location_name,
    array_agg(g.id order by g.group_name) as sloc_group_ids,
    array_agg(g.group_name order by g.group_name) as sloc_group_names,
    count(*) as active_group_count
  from erp_procurement.planning_sloc_group_member m
  join erp_procurement.planning_sloc_group g
    on g.id = m.sloc_group_id
   and g.active = true
  left join erp_master.companies c
    on c.id = g.company_id
  left join erp_inventory.storage_location_master sl
    on sl.id = m.storage_location_id
  where m.active = true
  group by
    g.company_id,
    c.company_code,
    m.storage_location_id,
    sl.code,
    sl.name
  having count(*) > 1
),
group_usage as (
  select
    g.id as sloc_group_id,
    g.group_name,
    g.company_id,
    count(distinct ig.id) as active_item_group_count,
    count(distinct case when pl.status = 'OPEN' then pl.id end) as open_plan_count,
    count(distinct case when pl.status = 'CLOSED' then pl.id end) as closed_plan_count,
    count(distinct pll.id) as total_plan_line_count,
    count(distinct case when pl.status = 'OPEN' then pll.id end) as open_plan_line_count,
    count(distinct case when pl.status = 'CLOSED' then pll.id end) as closed_plan_line_count
  from erp_procurement.planning_sloc_group g
  left join erp_procurement.planning_item_group ig
    on ig.sloc_group_id = g.id
   and ig.active = true
  left join erp_procurement.procurement_monthly_plan_line pll
    on pll.source_sloc_group_id = g.id
  left join erp_procurement.procurement_monthly_plan pl
    on pl.id = pll.plan_id
  group by g.id, g.group_name, g.company_id
)
select
  d.company_code,
  d.storage_location_code,
  d.storage_location_name,
  d.active_group_count,
  g.group_name,
  g.id as sloc_group_id,
  gu.active_item_group_count,
  gu.open_plan_count,
  gu.closed_plan_count,
  gu.open_plan_line_count,
  gu.closed_plan_line_count,
  gu.total_plan_line_count
from duplicate_memberships d
cross join lateral unnest(d.sloc_group_ids) with ordinality as grp(sloc_group_id, ord)
join erp_procurement.planning_sloc_group g
  on g.id = grp.sloc_group_id
left join group_usage gu
  on gu.sloc_group_id = g.id
order by
  d.company_code,
  d.storage_location_code,
  grp.ord,
  g.group_name;
