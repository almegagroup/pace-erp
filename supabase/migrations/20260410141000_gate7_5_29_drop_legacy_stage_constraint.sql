/*
 * File-ID: 7.5.29
 * File-Path: supabase/migrations/20260410141000_gate7_5_29_drop_legacy_stage_constraint.sql
 * Gate: 7.5
 * Phase: 7.5
 * Domain: ACL
 * Purpose: Remove legacy table-level single-stage uniqueness so same-stage multi-approver ANYONE routing works.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE acl.approver_map
  DROP CONSTRAINT IF EXISTS uq_company_module_stage;

COMMIT;
