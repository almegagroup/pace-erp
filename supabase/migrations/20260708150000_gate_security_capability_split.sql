/*
 * Migration: 20260708150000_gate_security_capability_split
 * Purpose: Split "Gate & Receiving" into a narrower Security-only capability.
 *          CAP_PROC_RECEIVING (Stores/Warehouse) keeps full access: GE, Gate
 *          Exit, GRN, GE Prune. New CAP_PROC_GATE_SECURITY grants ONLY Gate
 *          Entry + Gate Exit — no GRN, no GE Prune (prune requires
 *          PROC_GRN_LIST per the route-acl-registry.ts fix in this session).
 */

BEGIN;

-- ── NEW CAPABILITY ────────────────────────────────────────────────────────────
INSERT INTO acl.capabilities (capability_code, capability_name, description, is_system)
VALUES
  ('CAP_PROC_GATE_SECURITY', 'Gate Security',
   'Security/gate staff only — Gate Entry and Gate Exit. No GRN access, no GE Prune.',
   false)
ON CONFLICT (capability_code) DO NOTHING;

-- ── CAPABILITY → MENU ACTIONS (Gate Entry + Gate Exit only) ───────────────────
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT 'CAP_PROC_GATE_SECURITY', am.id, v.action, true
FROM (VALUES
  ('PROC_GATE_ENTRY_LIST',   'VIEW'),
  ('PROC_GATE_ENTRY_CREATE', 'VIEW'),
  ('PROC_GATE_ENTRY_CREATE', 'CREATE'),
  ('PROC_GATE_ENTRY_CREATE', 'WRITE'),
  ('PROC_GATE_EXIT',         'VIEW'),
  ('PROC_GATE_EXIT',         'WRITE')
) AS v(menu_code, action)
JOIN acl.menu_master am ON am.menu_code = v.menu_code
ON CONFLICT DO NOTHING;

-- ── ROLE → CAPABILITY (same role set as CAP_PROC_RECEIVING; actual grant is
--    scoped per work_context — see acl.work_context_capabilities) ────────────
INSERT INTO acl.role_capabilities (role_code, capability_code)
SELECT role_code, 'CAP_PROC_GATE_SECURITY'
FROM acl.role_capabilities
WHERE capability_code = 'CAP_PROC_RECEIVING'
ON CONFLICT DO NOTHING;

COMMIT;
