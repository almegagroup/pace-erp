/*
 * File-ID: 7.5.30
 * File-Path: supabase/migrations/20260414120000_gate7_5_30_drop_broad_exact_approver_uniques.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Remove broad exact-resource approver uniqueness indexes that wrongly block the same approver across multiple requester scopes in scoped approval routing.
 * Authority: Backend
 */

BEGIN;

/*
  Why this migration exists
  -------------------------
  Current scoped approval routing is intended to allow:

  - same approver user across multiple requester scopes
    Example:
      - Pradip approves DEPT_DPT009 | SUPPLY CHAIN
      - Pradip also approves DEPT_DPT003 | PRODUCTION

  - same approver role across multiple requester scopes
  - same approver reused for department + functional override models

  The following broad exact-resource indexes are too restrictive because
  they key uniqueness only by:

    company_id,
    module_code,
    resource_code,
    action_code,
    approver_user_id / approver_role_code

  They do NOT include:
    - subject_work_context_id
    - approval_stage

  Because of that, they incorrectly reject valid scoped rows whenever the
  same approver is reused for another requester scope under the same
  exact approval resource/action.

  Safety / non-breaking rationale
  -------------------------------
  This migration does NOT remove scoped uniqueness protection.

  The following stricter scoped indexes already exist and remain in place:

    - acl.uq_approver_user_exact_subject_scope
    - acl.uq_approver_role_exact_subject_scope

  Those indexes still protect against true duplicate scoped approval rows by
  including requester subject scope and approval stage.

  Therefore:
    - valid multi-scope approver reuse becomes allowed
    - exact duplicate scoped rows remain blocked
    - approval security model is preserved
*/

DROP INDEX IF EXISTS acl.uq_approver_user_exact_scope;
DROP INDEX IF EXISTS acl.uq_approver_role_exact_scope;

COMMIT;