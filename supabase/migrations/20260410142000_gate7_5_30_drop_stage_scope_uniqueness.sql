/*
 * File-ID: 7.5.30
 * File-Path: supabase/migrations/20260410142000_gate7_5_30_drop_stage_scope_uniqueness.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Remove remaining stage-only uniqueness indexes so ANYONE mode can keep multiple approvers at the same stage within the same scope.
 * Authority: Backend
 */

BEGIN;

DROP INDEX IF EXISTS acl.uq_approver_stage_per_module;
DROP INDEX IF EXISTS acl.uq_approver_stage_legacy_scope;
DROP INDEX IF EXISTS acl.uq_approver_stage_exact_scope;

COMMIT;
