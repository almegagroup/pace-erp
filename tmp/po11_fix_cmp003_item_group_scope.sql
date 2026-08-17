with target_sloc as (
  select g.id
  from erp_procurement.planning_sloc_group g
  join erp_master.companies c on c.id = g.company_id
  where c.company_code = 'CMP003'
    and g.group_name = 'ASCL_ADMIX'
    and g.active = true
), target_item as (
  select ig.id
  from erp_procurement.planning_item_group ig
  join erp_master.companies c on c.id = ig.company_id
  where c.company_code = 'CMP003'
    and ig.group_name = 'ASCL_RM_PM'
    and ig.active = true
)
update erp_procurement.planning_item_group ig
set sloc_group_id = (select id from target_sloc),
    last_updated_at = now()
where ig.id = (select id from target_item)
  and exists (select 1 from target_sloc)
returning ig.id, ig.group_name, ig.sloc_group_id;
