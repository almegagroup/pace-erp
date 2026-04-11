/*
 * File-ID: 7.5.29
 * File-Path: supabase/migrations/20260411154500_gate7_5_29_drop_remaining_legacy_module_approver_uniques.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Remove remaining module-wide approver uniqueness indexes that still block the same approver across multiple requester scopes and exact approval resources.
 * Authority: Backend
 */

BEGIN;

/*
  Scoped approval routing now keys uniqueness by:
  - company
  - module
  - exact resource/action when present
  - requester subject work context
  - approval stage
  - approver user or role

  The older per-module indexes below are broader than the scoped model
  and wrongly reject valid rows such as:
  - same approver user for Supply Chain and Production
  - same approver user for department + functional override
  - same approver role reused across multiple exact approval resources
*/

DROP INDEX IF EXISTS acl.uq_approver_user_per_module;
DROP INDEX IF EXISTS acl.uq_approver_role_per_module;

COMMIT;
