/*
 * Migration: 20260708150001_register_po_create_capability
 * Purpose: acl.menu_master never had a row for PROC_PO_CREATE, even though
 *          route-acl-registry.ts references this resourceCode for every PO
 *          write action (create/edit/delete/approve/cancel/confirm/amend/
 *          knock-off). Because the row was missing, no role or capability
 *          could ever grant it — PO creation/edit has been DENY-ALL for
 *          every non-SA/GA user since whenever this row was dropped.
 *          Registers the companion resource (route-only, like
 *          PROC_GATE_ENTRY_CREATE) and grants CAP_PROC_BUYER the actions a
 *          buyer needs (this capability already grants PROC_PO_LIST: VIEW).
 */

BEGIN;

INSERT INTO acl.menu_master (menu_code, display_name)
VALUES ('PROC_PO_CREATE', 'Purchase Order Create')
ON CONFLICT (menu_code) DO NOTHING;

INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT 'CAP_PROC_BUYER', am.id, v.action, true
FROM (VALUES ('VIEW'), ('WRITE'), ('EDIT'), ('DELETE'), ('APPROVE')) AS v(action)
JOIN acl.menu_master am ON am.menu_code = 'PROC_PO_CREATE'
ON CONFLICT DO NOTHING;

COMMIT;
