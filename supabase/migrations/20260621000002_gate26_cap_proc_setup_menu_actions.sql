-- Gate-26: Wire 7 procurement master pages into CAP_PROC_SETUP capability
-- These pages were added to acl.menu_master in Gate-26 but were never mapped
-- to capability_menu_actions, so ACL users couldn't see them in the sidebar.

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
VALUES
  ('CAP_PROC_SETUP', '01cf182b-8e3d-456e-be42-b2ab4a66a45f', 'VIEW', true),  -- PROC_PAYMENT_TERMS_MASTER  (PM01)
  ('CAP_PROC_SETUP', 'd4e64b6f-afca-4bb0-983c-cf406a09da69', 'VIEW', true),  -- PROC_PORT_MASTER            (PM02)
  ('CAP_PROC_SETUP', '0479b9b0-e31c-4220-82c7-bbb516c5cf0a', 'VIEW', true),  -- PROC_PORT_TRANSIT_MASTER    (PM03)
  ('CAP_PROC_SETUP', '64d6428d-bf8d-4a64-b77d-8c9399f06601', 'VIEW', true),  -- PROC_MATERIAL_CATEGORY_MASTER (PM04)
  ('CAP_PROC_SETUP', '36354f9b-59fa-41b0-b8f7-21a519a6270f', 'VIEW', true),  -- PROC_IMPORT_LEAD_TIME_MASTER (PM05)
  ('CAP_PROC_SETUP', 'f5eca0fc-54c4-482a-9c83-6dc9e3cb2b10', 'VIEW', true),  -- PROC_TRANSPORTER_MASTER     (PM06)
  ('CAP_PROC_SETUP', '2fa05f81-13b7-46eb-bf76-a9fa8f96a5b5', 'VIEW', true)   -- PROC_CHA_MASTER             (PM07)
ON CONFLICT DO NOTHING;
