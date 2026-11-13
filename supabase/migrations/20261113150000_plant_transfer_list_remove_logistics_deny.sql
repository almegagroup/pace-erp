/*
 * ACL-MASTER drift fix: PROC_PLANT_TRANSFER_LIST EDIT/WRITE (found 2026-11-13 by scripts/acl-master-drift-check.mjs).
 *
 * Prod had two explicit DENY rows (allowed = false, created 2026-10-06 03:57 UTC, not from any migration) for
 * CAP_PROC_LOGISTICS on PROC_PLANT_TRANSFER_LIST EDIT and WRITE. A DENY beats an ALLOW inside the same
 * (user, work context), so anyone whose work context holds CAP_PROC_LOGISTICS *and* a capability that grants those
 * actions lost them:
 *   - ACL-MASTER (P0074 / P0076, DIRECTOR, 4 companies) -- maintenance full access, must not be locked out (pattern #5)
 *   - the Accounts L3_MANAGERs P0003, P0065, P0100, P0073 (CAP_ACC_GRN_COST_PLANTHEAD / _MAKER)
 *
 * Business owner decided 2026-11-13: all of them are allowed Tab 1 write (Settlement Invoice, Cost Component Entry).
 * The intent "Stores/SCM/Logistics are VIEW-only on Tab 1" is unchanged: migration 20261006130000 already removed
 * CAP_PROC_LOGISTICS WRITE/EDIT on this resource, so Logistics-only users have no ALLOW source at all and stay denied
 * by default. Only allowed = false rows are deleted (a future allowed = true row is never touched).
 *
 * A captured ACL version is immutable (pattern #4), so every company gets a fresh version
 * (new -> capture -> generate -> activate -> rebuild menus) via acl.refresh_company_acl().
 * No-op on Dev (the DENY rows never existed there) apart from the version bump.
 */

DELETE FROM acl.capability_menu_actions cma
USING acl.menu_master mm
WHERE cma.menu_id = mm.id
  AND mm.menu_code = 'PROC_PLANT_TRANSFER_LIST'
  AND cma.capability_code = 'CAP_PROC_LOGISTICS'
  AND cma.action IN ('WRITE', 'EDIT')
  AND cma.allowed = false;

SELECT acl.refresh_company_acl(
         c.id,
         'Remove CAP_PROC_LOGISTICS deny on PROC_PLANT_TRANSFER_LIST EDIT/WRITE (ACL-MASTER drift)')
FROM erp_master.companies c
WHERE EXISTS (SELECT 1 FROM acl.acl_versions v WHERE v.company_id = c.id AND v.is_active);
