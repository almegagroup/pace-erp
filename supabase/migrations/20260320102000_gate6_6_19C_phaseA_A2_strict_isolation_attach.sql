/*
 * File-ID: ID-6.19C
 * File-Path: supabase/migrations/20260320102000_gate6_6_19C_phaseA_A2_strict_isolation_attach.sql
 * Gate: 6
 * Phase: A (DB Hard Security Closure)
 * Domain: RLS Enforcement
 * Purpose: Deterministic isolation (SAP style — mapping based, no direct project.company_id dependency)
 * Authority: Backend
 * Idempotent: YES
 */

BEGIN;

-------------------------------------------------------
-- DROP ALL EXISTING ISOLATION POLICIES (SAFE)
-------------------------------------------------------

DROP POLICY IF EXISTS companies_isolation ON erp_master.companies;
DROP POLICY IF EXISTS departments_isolation ON erp_master.departments;
DROP POLICY IF EXISTS projects_isolation ON erp_master.projects;
DROP POLICY IF EXISTS groups_isolation ON erp_master.groups;

DROP POLICY IF EXISTS company_group_isolation ON erp_map.company_group;
DROP POLICY IF EXISTS company_projects_isolation ON erp_map.company_projects;
DROP POLICY IF EXISTS user_companies_isolation ON erp_map.user_companies;
DROP POLICY IF EXISTS user_company_roles_isolation ON erp_map.user_company_roles;
DROP POLICY IF EXISTS user_departments_isolation ON erp_map.user_departments;
DROP POLICY IF EXISTS user_projects_isolation ON erp_map.user_projects;

DROP POLICY IF EXISTS users_self_isolation ON erp_core.users;
DROP POLICY IF EXISTS sessions_self_isolation ON erp_core.sessions;
DROP POLICY IF EXISTS signup_requests_self_isolation ON erp_core.signup_requests;

-------------------------------------------------------
-- 1️⃣ COMPANY ROOT ISOLATION
-------------------------------------------------------

CREATE POLICY companies_isolation
ON erp_master.companies
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR id = erp_meta.req_company_id()
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR id = erp_meta.req_company_id()
);

-------------------------------------------------------
-- 2️⃣ DEPARTMENTS (mapping via company_id — stays)
-------------------------------------------------------

CREATE POLICY departments_isolation
ON erp_master.departments
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR company_id = erp_meta.req_company_id()
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR company_id = erp_meta.req_company_id()
);

-------------------------------------------------------
-- 3️⃣ PROJECTS (SAP style — via company_projects mapping)
-------------------------------------------------------

CREATE POLICY projects_isolation
ON erp_master.projects
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR EXISTS (
      SELECT 1
      FROM erp_map.company_projects cp
      WHERE cp.project_id = projects.id
        AND cp.company_id = erp_meta.req_company_id()
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR EXISTS (
      SELECT 1
      FROM erp_map.company_projects cp
      WHERE cp.project_id = projects.id
        AND cp.company_id = erp_meta.req_company_id()
  )
);

-------------------------------------------------------
-- 4️⃣ GROUPS (unchanged logic)
-------------------------------------------------------

CREATE POLICY groups_isolation
ON erp_master.groups
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR EXISTS (
    SELECT 1
    FROM erp_map.company_group cg
    WHERE cg.group_id = groups.id
      AND cg.company_id = erp_meta.req_company_id()
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR EXISTS (
    SELECT 1
    FROM erp_map.company_group cg
    WHERE cg.group_id = groups.id
      AND cg.company_id = erp_meta.req_company_id()
  )
);

-------------------------------------------------------
-- 5️⃣ erp_map tables
-------------------------------------------------------

CREATE POLICY company_group_isolation
ON erp_map.company_group
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR company_id = erp_meta.req_company_id()
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR company_id = erp_meta.req_company_id()
);

CREATE POLICY company_projects_isolation
ON erp_map.company_projects
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR company_id = erp_meta.req_company_id()
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR company_id = erp_meta.req_company_id()
);

CREATE POLICY user_companies_isolation
ON erp_map.user_companies
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR company_id = erp_meta.req_company_id()
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR company_id = erp_meta.req_company_id()
);

CREATE POLICY user_company_roles_isolation
ON erp_map.user_company_roles
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR company_id = erp_meta.req_company_id()
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR company_id = erp_meta.req_company_id()
);

CREATE POLICY user_departments_isolation
ON erp_map.user_departments
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR EXISTS (
    SELECT 1
    FROM erp_master.departments d
    WHERE d.id = user_departments.department_id
      AND d.company_id = erp_meta.req_company_id()
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR EXISTS (
    SELECT 1
    FROM erp_master.departments d
    WHERE d.id = user_departments.department_id
      AND d.company_id = erp_meta.req_company_id()
  )
);

CREATE POLICY user_projects_isolation
ON erp_map.user_projects
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR EXISTS (
      SELECT 1
      FROM erp_map.company_projects cp
      WHERE cp.project_id = user_projects.project_id
        AND cp.company_id = erp_meta.req_company_id()
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR EXISTS (
      SELECT 1
      FROM erp_map.company_projects cp
      WHERE cp.project_id = user_projects.project_id
        AND cp.company_id = erp_meta.req_company_id()
  )
);

-------------------------------------------------------
-- 6️⃣ USER-SCOPED TABLES
-------------------------------------------------------

CREATE POLICY users_self_isolation
ON erp_core.users
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR auth_user_id = auth.uid()
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR auth_user_id = auth.uid()
);

CREATE POLICY sessions_self_isolation
ON erp_core.sessions
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR auth_user_id = auth.uid()
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR auth_user_id = auth.uid()
);

CREATE POLICY signup_requests_self_isolation
ON erp_core.signup_requests
FOR ALL
TO authenticated
USING (
  erp_meta.req_is_admin() = true
  OR auth_user_id = auth.uid()
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR auth_user_id = auth.uid()
);

COMMIT;