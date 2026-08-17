select
  c.company_code,
  ig.group_name as item_group_name,
  sg.group_name as parent_sloc_group,
  ig.sloc_group_id,
  ig.active,
  ig.created_at,
  ig.last_updated_at
from erp_procurement.planning_item_group ig
join erp_master.companies c on c.id = ig.company_id
left join erp_procurement.planning_sloc_group sg on sg.id = ig.sloc_group_id
where c.company_code = 'CMP003'
  and ig.group_name = 'ASCL_RM_PM';
