SELECT
  m.menu_id,
  m.menu_label,
  m.route_path,
  r.resource_code,
  r.action_code
FROM menu.menu_master m
JOIN menu.menu_resources r
  ON m.menu_id = r.menu_id
JOIN acl.precomputed_acl_view a
  ON a.resource_code = r.resource_code
WHERE
  a.auth_user_id = 'USER_ID_HERE'
AND a.company_id = 'COMPANY_ID_HERE'
AND a.decision = 'ALLOW';