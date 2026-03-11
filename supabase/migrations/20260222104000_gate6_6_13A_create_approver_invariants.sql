/*
 * File-ID: ID-6.13A
 * File-Path: supabase/migrations/20260222103000_gate6_6_13A_create_approver_invariants.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Structural invariants for approval routing.
 * Authority: Backend
 */

BEGIN;

/*
  NOTE:
  Gate-6 only declares structural integrity.
  Workflow behaviour validation (non-empty chain, circular detection,
  stage continuity) will be enforced in approval engine layer (future Gates).
*/

-- Prevent duplicate approver role within same company + module
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_module_role
ON acl.approver_map (company_id, module_code, approver_role_code)
WHERE approver_role_code IS NOT NULL;

-- Prevent duplicate specific user approver within same company + module
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_module_user
ON acl.approver_map (company_id, module_code, approver_user_id)
WHERE approver_user_id IS NOT NULL;

COMMIT;