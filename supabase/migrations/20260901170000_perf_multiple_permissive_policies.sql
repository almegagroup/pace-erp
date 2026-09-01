/*
 * File-Path: supabase/migrations/20260901170000_perf_multiple_permissive_policies.sql
 * Gate: SECURITY / PERF
 * Phase: POST-L2
 * Domain: SECURITY / RLS
 * Purpose:
 *   Fix multiple_permissive_policies advisor findings (60 WARN, both dev and
 *   prod). Not a blind consolidation -- each pair's actual USING/WITH CHECK
 *   clause was read via pg_policies before deciding the fix, since Postgres
 *   ORs multiple PERMISSIVE policies together, so merging them wrong can
 *   silently widen access.
 *
 *   GROUP A (9 tables: erp_map.company_group/company_projects/user_companies/
 *   user_departments/user_projects, erp_master.companies/departments/groups/
 *   projects) -- each has a `<table>_isolation` policy (role=authenticated,
 *   plain company_id match) and a `<table>_rls` policy (role=public, same
 *   match ALSO requiring the company be status='ACTIVE'). Confirmed via
 *   has_table_privilege() that `anon` has zero base GRANT on any of these 9
 *   tables, so `_rls`'s role=public scoping is irrelevant for anon in
 *   practice -- only `authenticated` reaches the RLS layer at all. Because
 *   both policies apply to `authenticated` and are OR'd, and `_isolation`'s
 *   clause is a strict superset of `_rls`'s clause (X OR (X AND Y) = X), the
 *   ACTIVE-company check in `_rls` was already fully dead for `authenticated`
 *   -- `_isolation` alone already decided the outcome. Dropping `_isolation`
 *   and keeping `_rls` is mathematically a zero-behavior-change consolidation
 *   for the only role that matters here, and it happens to also close a
 *   latent defense-in-depth gap (a request forging its company-id context
 *   header to point at a real but INACTIVE company was never actually
 *   blocked by the dead check).
 *
 *   GROUP B (acl.precomputed_acl_view) -- `acl_snapshot_context_policy`
 *   (correct per-row company/project/department scoping) and
 *   `acl_snapshot_deny_when_context_missing` (intended as a guard: block
 *   everything when no company context is present), both created PERMISSIVE.
 *   `acl_snapshot_deny_when_context_missing`'s clause is
 *   `is_admin OR req_company_id() IS NOT NULL` -- it does not reference the
 *   row's own company_id at all, so once OR'd against the correct policy, it
 *   is not a guard, it is a full bypass: ANY authenticated caller with ANY
 *   non-null company context (i.e. essentially every normal request) sees
 *   EVERY row in this table regardless of which company actually owns it.
 *   Confirmed authenticated has base SELECT grant on this table. Real cross-
 *   tenant ACL-data leak, not a redundancy. The fix: this policy was always
 *   meant to compose via AND (a guard clause), not OR -- convert it from
 *   PERMISSIVE to RESTRICTIVE. Postgres composes RESTRICTIVE policies via AND
 *   with the PERMISSIVE set, so the correct per-row scoping in
 *   acl_snapshot_context_policy can no longer be bypassed.
 */

BEGIN;

-- ============================================================
-- GROUP A: drop the now-redundant broader policy on 9 tables.
-- ============================================================

DROP POLICY IF EXISTS company_group_isolation ON erp_map.company_group;
DROP POLICY IF EXISTS company_projects_isolation ON erp_map.company_projects;
DROP POLICY IF EXISTS user_companies_isolation ON erp_map.user_companies;
DROP POLICY IF EXISTS user_departments_isolation ON erp_map.user_departments;
DROP POLICY IF EXISTS user_projects_isolation ON erp_map.user_projects;
DROP POLICY IF EXISTS companies_isolation ON erp_master.companies;
DROP POLICY IF EXISTS departments_isolation ON erp_master.departments;
DROP POLICY IF EXISTS groups_isolation ON erp_master.groups;
DROP POLICY IF EXISTS projects_isolation ON erp_master.projects;

-- ============================================================
-- GROUP B: acl.precomputed_acl_view -- convert the guard policy
-- from PERMISSIVE (bypass) to RESTRICTIVE (actual guard).
-- ============================================================

DROP POLICY IF EXISTS acl_snapshot_deny_when_context_missing ON acl.precomputed_acl_view;

CREATE POLICY acl_snapshot_deny_when_context_missing
  ON acl.precomputed_acl_view
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING (
    (erp_meta.req_is_admin() = true) OR (erp_meta.req_company_id() IS NOT NULL)
  );

COMMIT;
