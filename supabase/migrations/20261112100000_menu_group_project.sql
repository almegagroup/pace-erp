-- Sidebar projects: which project each menu GROUP belongs to.
--
-- The sidebar shows Project rows (e.g. HRM, Operation Management) that expand to the groups ("modules") under them.
-- A group's project is data, so a future project only needs its groups tagged -- no code change.
--
-- Stored on the menu group itself (nullable FK): one value per group, and the menu API already reads
-- erp_menu.menu_master. Only business (ACL) groups carry a project; Super-Admin groups stay project-less.
--
-- Backfill is data-driven, not hard-coded to project codes (dev and prod use different project codes): a group's
-- project = the project of the module most of its already-mapped pages belong to (ties: lowest project code).
-- A group none of whose pages is mapped to any module is left NULL and shows on its own.

ALTER TABLE erp_menu.menu_master
  ADD COLUMN IF NOT EXISTS project_id uuid NULL REFERENCES erp_master.projects(id);

COMMENT ON COLUMN erp_menu.menu_master.project_id IS
  'Project this menu GROUP sits under in the sidebar (NULL = shown on its own). Only meaningful for GROUP rows.';

WITH group_project AS (
  SELECT g.id AS group_id, mr.project_id, p.project_code, count(*) AS n,
         row_number() OVER (PARTITION BY g.id ORDER BY count(*) DESC, p.project_code) AS rnk
  FROM erp_menu.menu_master g
  JOIN erp_menu.menu_tree t ON t.parent_menu_id = g.id
  JOIN erp_menu.menu_master pg ON pg.id = t.child_menu_id AND pg.menu_type = 'PAGE'
  JOIN acl.module_resource_map r ON r.resource_code = pg.resource_code
  JOIN acl.module_registry mr ON mr.module_code = r.module_code AND mr.project_id IS NOT NULL
  JOIN erp_master.projects p ON p.id = mr.project_id
  WHERE g.menu_type = 'GROUP' AND g.universe = 'ACL'
  GROUP BY g.id, mr.project_id, p.project_code
)
UPDATE erp_menu.menu_master g
SET project_id = gp.project_id
FROM group_project gp
WHERE gp.group_id = g.id AND gp.rnk = 1 AND g.project_id IS NULL;

NOTIFY pgrst, 'reload schema';
