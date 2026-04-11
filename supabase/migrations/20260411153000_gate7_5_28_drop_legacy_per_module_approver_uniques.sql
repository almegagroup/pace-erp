/*
 * File-ID: 7.5.28
 * File-Path: supabase/migrations/20260411153000_gate7_5_28_drop_legacy_per_module_approver_uniques.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Remove obsolete per-company-per-module approver uniqueness indexes that block scoped multi-department and cross-company approver routing.
 * Authority: Backend
 */

BEGIN;

/*
  These two indexes came from the early module-wide approval model.
  After scoped approval routing was introduced, they became too broad:

  - one user should be able to approve multiple requester scopes
  - one role should be able to approve multiple requester scopes
  - exact resource/action + requester subject scope uniqueness now governs safety

  Keeping the old indexes blocks valid rules such as:
  - same approver user for Supply Chain and Production
  - same approver user for PROD_POWDER and PROD_LIQUID
  - same approver role across multiple scoped approval chains
*/

DROP INDEX IF EXISTS acl.uq_company_module_user;
DROP INDEX IF EXISTS acl.uq_company_module_role;

COMMIT;
