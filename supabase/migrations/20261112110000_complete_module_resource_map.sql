-- Complete the module -> page map.
--
-- A company can switch a module off ("Company Modules"); generate_acl_snapshot then denies every page mapped to that
-- module for that company (MODULE_DISABLED). A page that is in NO module can never be switched off per company, so a
-- company that should only have HR would still show those pages whenever a role allows them.
--
-- Each unmapped business page is mapped to the module its sidebar group mostly uses (majority of the group's already
-- mapped pages; ties go to the module that sorts first). Pages with no group (Dashboard) stay unmapped on purpose:
-- they must always be visible. Idempotent; mappings that already exist are untouched.
--
-- Takes effect for a company the next time its ACL snapshot is generated. A company with all modules enabled sees no
-- change at all.

WITH page_group AS (
  SELECT m.resource_code, g.id AS group_id
  FROM erp_menu.menu_master m
  JOIN erp_menu.menu_tree t ON t.child_menu_id = m.id
  JOIN erp_menu.menu_master g ON g.id = t.parent_menu_id AND g.menu_type = 'GROUP'
  WHERE m.menu_type = 'PAGE' AND m.universe = 'ACL' AND m.is_active
),
group_module AS (
  SELECT pg.group_id, r.module_code, count(*) AS n,
         row_number() OVER (PARTITION BY pg.group_id ORDER BY count(*) DESC, r.module_code) AS rnk
  FROM page_group pg
  JOIN acl.module_resource_map r ON r.resource_code = pg.resource_code
  GROUP BY pg.group_id, r.module_code
)
INSERT INTO acl.module_resource_map (module_code, resource_code, created_by)
SELECT gm.module_code, pg.resource_code, NULL
FROM page_group pg
JOIN group_module gm ON gm.group_id = pg.group_id AND gm.rnk = 1
WHERE NOT EXISTS (SELECT 1 FROM acl.module_resource_map x WHERE x.resource_code = pg.resource_code)
ON CONFLICT DO NOTHING;
