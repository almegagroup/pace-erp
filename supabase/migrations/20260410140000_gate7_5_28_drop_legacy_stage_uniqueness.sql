/*
 * File-ID: 7.5.28
 * File-Path: supabase/migrations/20260410140000_gate7_5_28_drop_legacy_stage_uniqueness.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Remove legacy single-approver-per-stage uniqueness so ANYONE mode can keep multiple approvers at the same stage.
 * Authority: Backend
 */

BEGIN;

DROP INDEX IF EXISTS acl.uq_approver_stage_per_module;

COMMIT;
