DO $$

DECLARE
  v_auth_user_id UUID := 'YOUR_USER_ID';
  v_root_id UUID;

BEGIN

  -- ============================================
  -- 0️⃣ VALIDATION
  -- ============================================

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_user_id cannot be NULL';
  END IF;

  -- ============================================
  -- 1️⃣ ENSURE USER
  -- ============================================

  INSERT INTO erp_core.users (
    auth_user_id,
    user_code,
    state,
    created_at
  )
  VALUES (
    v_auth_user_id,
    'SA001',
    'ACTIVE',
    now()
  )
  ON CONFLICT (auth_user_id) DO UPDATE
  SET state = 'ACTIVE';

  -- ============================================
  -- 2️⃣ ROOT MENU
  -- ============================================

  INSERT INTO erp_menu.menu_master (
    menu_code,
    resource_code,
    title,
    route_path,
    menu_type,
    universe,
    is_system,
    display_order,
    is_active,
    created_at,
    created_by
  )
  VALUES (
    'SA_ROOT',
    'SA_ROOT',
    'Admin Root',
    NULL,
    'GROUP',
    'SA',
    true,
    0,
    true,
    now(),
    'SYSTEM'
  )
  ON CONFLICT (menu_code) DO NOTHING;

  SELECT id INTO v_root_id
  FROM erp_menu.menu_master
  WHERE menu_code = 'SA_ROOT'
  LIMIT 1;

  IF v_root_id IS NULL THEN
    RAISE EXCEPTION 'SA_ROOT not found';
  END IF;

  -- ============================================
  -- 3️⃣ MENU PAGES (IDEMPOTENT)
  -- ============================================

  INSERT INTO erp_menu.menu_master (
    menu_code,
    resource_code,
    title,
    route_path,
    menu_type,
    universe,
    is_system,
    display_order,
    is_active,
    created_at,
    created_by
  )
  VALUES
    ('SA_HOME','SA_HOME','Dashboard','/sa/home','PAGE','SA',true,1,true,now(),'SYSTEM'),
    ('SA_CONTROL_PANEL','SA_CONTROL_PANEL','Control Panel','/sa/control-panel','PAGE','SA',true,2,true,now(),'SYSTEM'),
    ('SA_COMPANY_CREATE','SA_COMPANY_CREATE','Create Company','/sa/company/create','PAGE','SA',true,3,true,now(),'SYSTEM'),
    ('SA_PROJECT_MASTER','SA_PROJECT_MASTER','Project Master','/sa/project-master','PAGE','SA',true,4,true,now(),'SYSTEM'),
    ('SA_USERS','SA_USERS','User Control','/sa/users','PAGE','SA',true,5,true,now(),'SYSTEM'),
    ('SA_ROLE_PERMISSIONS','SA_ROLE_PERMISSIONS','Role Permissions','/sa/acl/role-permissions','PAGE','SA',true,6,true,now(),'SYSTEM'),
    ('SA_APPROVAL_RULES','SA_APPROVAL_RULES','Approval Rules','/sa/approval-rules','PAGE','SA',true,7,true,now(),'SYSTEM'),
    ('SA_COMPANY_MODULE_MAP','SA_COMPANY_MODULE_MAP','Company Modules','/sa/acl/company-modules','PAGE','SA',true,8,true,now(),'SYSTEM'),
    ('SA_SIGNUP_REQUESTS','SA_SIGNUP_REQUESTS','Signup Requests','/sa/signup-requests','PAGE','SA',true,9,true,now(),'SYSTEM'),
    ('SA_MENU_GOVERNANCE','SA_MENU_GOVERNANCE','Menu Governance','/sa/menu','PAGE','SA',true,10,true,now(),'SYSTEM'),
    ('SA_ORG_BOOTSTRAP','SA_ORG_BOOTSTRAP','Organization Bootstrap','/sa/org-bootstrap','PAGE','SA',true,11,true,now(),'SYSTEM'),
    ('SA_SYSTEM_HEALTH','SA_SYSTEM_HEALTH','System Health','/sa/system-health','PAGE','SA',true,1,true,now(),'SYSTEM'),
    ('SA_AUDIT','SA_AUDIT','Audit Viewer','/sa/audit','PAGE','SA',true,2,true,now(),'SYSTEM'),
    ('SA_SESSIONS','SA_SESSIONS','Session Control','/sa/sessions','PAGE','SA',true,3,true,now(),'SYSTEM'),
    ('SA_USER_ROLES','SA_USER_ROLES','User Roles','/sa/users/roles','PAGE','SA',true,1,true,now(),'SYSTEM'),
    ('SA_USER_SCOPE','SA_USER_SCOPE','User Scope','/sa/users/scope','PAGE','SA',true,2,true,now(),'SYSTEM')
  ON CONFLICT (menu_code) DO UPDATE
  SET
    title = EXCLUDED.title,
    route_path = EXCLUDED.route_path,
    display_order = EXCLUDED.display_order,
    is_active = true;

  -- ============================================
  -- 4️⃣ CLEAN OLD TREE (FULL RESET FOR SA)
  -- ============================================

  DELETE FROM erp_menu.menu_tree
  WHERE child_menu_id IN (
    SELECT id FROM erp_menu.menu_master WHERE universe = 'SA'
  );

  -- ============================================
  -- 5️⃣ REBUILD TREE
  -- ============================================

  INSERT INTO erp_menu.menu_tree (
    parent_menu_id,
    child_menu_id,
    display_order,
    created_at,
    created_by
  )
  SELECT
    parent_menu.id,
    child_menu.id,
    mapping.display_order,
    now(),
    'SYSTEM'
  FROM (
    VALUES
      ('SA_HOME', 'SA_ROOT', 1),
      ('SA_CONTROL_PANEL', 'SA_ROOT', 2),
      ('SA_COMPANY_CREATE', 'SA_ROOT', 3),
      ('SA_PROJECT_MASTER', 'SA_ROOT', 4),
      ('SA_USERS', 'SA_ROOT', 5),
      ('SA_ROLE_PERMISSIONS', 'SA_ROOT', 6),
      ('SA_APPROVAL_RULES', 'SA_ROOT', 7),
      ('SA_COMPANY_MODULE_MAP', 'SA_ROOT', 8),
      ('SA_SIGNUP_REQUESTS', 'SA_ROOT', 9),
      ('SA_MENU_GOVERNANCE', 'SA_ROOT', 10),
      ('SA_ORG_BOOTSTRAP', 'SA_ROOT', 11),
      ('SA_SYSTEM_HEALTH', 'SA_CONTROL_PANEL', 1),
      ('SA_AUDIT', 'SA_CONTROL_PANEL', 2),
      ('SA_SESSIONS', 'SA_CONTROL_PANEL', 3),
      ('SA_USER_ROLES', 'SA_USERS', 1),
      ('SA_USER_SCOPE', 'SA_USERS', 2)
  ) AS mapping(child_code, parent_code, display_order)
  JOIN erp_menu.menu_master child_menu
    ON child_menu.menu_code = mapping.child_code
  JOIN erp_menu.menu_master parent_menu
    ON parent_menu.menu_code = mapping.parent_code;

  -- ============================================
  -- 6️⃣ GENERATE SNAPSHOT (GLOBAL)
  -- ============================================

  PERFORM erp_menu.generate_menu_snapshot(
    v_auth_user_id,
    NULL,
    'SA'
  );

  -- ============================================
  -- DONE
  -- ============================================

  RAISE NOTICE '🚀 SA GLOBAL BOOTSTRAP COMPLETE';

END $$;
