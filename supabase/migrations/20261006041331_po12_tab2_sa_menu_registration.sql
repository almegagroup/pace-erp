/*
 * File-Path: supabase/migrations/20261006041331_po12_tab2_sa_menu_registration.sql
 * Domain: PROCUREMENT / PO12 Tab 2 (Returnable Material Transfer)
 * Purpose: Registers the SA "PTO Company" page (frontend/src/admin/sa/screens/
 *          SAProcTransferGroupPage.jsx -- the Transfer Group allow-list master)
 *          in erp_menu.menu_master / acl.menu_master / erp_menu.menu_tree, so
 *          it shows up under the SA "Operation Masters" group. Resource code:
 *          SA_PROC_TRANSFER_GROUP.
 *
 * ⚠️ This file is a RECONCILIATION of a change already applied to Prod via
 * MCP `apply_migration` on 2026-10-06 (which recorded it in Prod's
 * supabase_migrations.schema_migrations under this exact version/name,
 * generated from the MCP call's own timestamp -- not from a local file,
 * since none existed yet). Per CLAUDE.md §8A's own documented fix for this
 * exact drift class: a local file must exist matching that recorded
 * version, or `supabase db push` refuses with "Remote migration versions
 * not found in local migrations directory" for every subsequent push.
 * Writing it now, byte-for-byte what was actually applied, closes that gap.
 *
 * Dev already carries an equivalent SA_PROC_TRANSFER_GROUP row (applied
 * earlier via MCP execute_sql, no migration -- treated as pure operational
 * data at the time, with tx_code OM11). Prod's OM11 was already taken by a
 * different page, so Prod's own row uses OM12 instead -- this migration
 * reproduces Prod's exact version. All three INSERTs are idempotent
 * (ON CONFLICT / NOT EXISTS guards keyed on resource_code/menu_code), so
 * applying this to Dev is a safe no-op (Dev's existing row already matches
 * on resource_code/menu_code and is left untouched, tx_code difference and
 * all) and applying it to Prod (already done) is also a no-op on replay.
 */

BEGIN;

INSERT INTO erp_menu.menu_master (
  menu_code, resource_code, title, description, route_path, menu_type,
  universe, is_system, display_order, is_active, created_by, tx_code
) VALUES (
  'SA_PROC_TRANSFER_GROUP', 'SA_PROC_TRANSFER_GROUP', 'PTO Company',
  'Transfer Group allow-list for PO12 Tab 2 returnable material transfer',
  '/sa/procurement/transfer-groups', 'PAGE', 'SA', false, 230, true, 'system', 'OM12'
)
ON CONFLICT (resource_code) DO NOTHING;

INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
VALUES ('SA_PROC_TRANSFER_GROUP', 'PTO Company', 'Transfer Group allow-list for PO12 Tab 2', false)
ON CONFLICT (menu_code) DO NOTHING;

INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order)
SELECT p.id, c.id, 230
FROM erp_menu.menu_master p, erp_menu.menu_master c
WHERE p.resource_code = 'GRP_SA_OM' AND c.resource_code = 'SA_PROC_TRANSFER_GROUP'
  AND NOT EXISTS (
    SELECT 1 FROM erp_menu.menu_tree mt
    JOIN erp_menu.menu_master cc ON cc.id = mt.child_menu_id
    WHERE cc.resource_code = 'SA_PROC_TRANSFER_GROUP'
  );

COMMIT;
