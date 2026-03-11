/*
 * File-ID: 6.19-FINAL
 * File-Path: supabase/migrations/20260317120000_gate6_6_19_FINAL_relational_rls.sql
 * Gate: 6
 * Phase: 6
 * Domain: DB
 * Purpose: Strict relational RLS (company boundary + lifecycle enforced everywhere)
 * Model: A (Admin bypass allowed, lifecycle blocks non-admin)
 * SAP-Style: Projects reusable, binding via company_projects
 * Idempotent: YES
 */

BEGIN;

-- ============================================================
-- ERP_MASTER.COMPANIES
-- ============================================================

DROP POLICY IF EXISTS companies_rls ON erp_master.companies;

CREATE POLICY companies_rls
ON erp_master.companies
FOR ALL
USING (
  erp_meta.req_is_admin() = true
  OR (
      id = erp_meta.req_company_id()
      AND status = 'ACTIVE'
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR (
      id = erp_meta.req_company_id()
      AND status = 'ACTIVE'
  )
);

-- ============================================================
-- ERP_MASTER.PROJECTS  (SAP-STYLE MAPPING BASED)
-- ============================================================

DROP POLICY IF EXISTS projects_rls ON erp_master.projects;

CREATE POLICY projects_rls
ON erp_master.projects
FOR ALL
USING (
  erp_meta.req_is_admin() = true
  OR EXISTS (
      SELECT 1
      FROM erp_map.company_projects cp
      JOIN erp_master.companies c
        ON c.id = cp.company_id
      WHERE cp.project_id = projects.id
        AND cp.company_id = erp_meta.req_company_id()
        AND c.status = 'ACTIVE'
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR EXISTS (
      SELECT 1
      FROM erp_map.company_projects cp
      JOIN erp_master.companies c
        ON c.id = cp.company_id
      WHERE cp.project_id = projects.id
        AND cp.company_id = erp_meta.req_company_id()
        AND c.status = 'ACTIVE'
  )
);

-- ============================================================
-- ERP_MASTER.DEPARTMENTS
-- ============================================================

DROP POLICY IF EXISTS departments_rls ON erp_master.departments;

CREATE POLICY departments_rls
ON erp_master.departments
FOR ALL
USING (
  erp_meta.req_is_admin() = true
  OR (
      company_id = erp_meta.req_company_id()
      AND EXISTS (
          SELECT 1
          FROM erp_master.companies c
          WHERE c.id = erp_meta.req_company_id()
            AND c.status = 'ACTIVE'
      )
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR (
      company_id = erp_meta.req_company_id()
      AND EXISTS (
          SELECT 1
          FROM erp_master.companies c
          WHERE c.id = erp_meta.req_company_id()
            AND c.status = 'ACTIVE'
      )
  )
);

-- ============================================================
-- ERP_MASTER.GROUPS
-- ============================================================

DROP POLICY IF EXISTS groups_rls ON erp_master.groups;

CREATE POLICY groups_rls
ON erp_master.groups
FOR ALL
USING (
  erp_meta.req_is_admin() = true
  OR EXISTS (
      SELECT 1
      FROM erp_map.company_group cg
      JOIN erp_master.companies c
        ON c.id = cg.company_id
      WHERE cg.group_id = groups.id
        AND cg.company_id = erp_meta.req_company_id()
        AND c.status = 'ACTIVE'
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR EXISTS (
      SELECT 1
      FROM erp_map.company_group cg
      JOIN erp_master.companies c
        ON c.id = cg.company_id
      WHERE cg.group_id = groups.id
        AND cg.company_id = erp_meta.req_company_id()
        AND c.status = 'ACTIVE'
  )
);

-- ============================================================
-- ERP_MAP TABLES (DIRECT company_id)
-- ============================================================

DROP POLICY IF EXISTS company_projects_rls ON erp_map.company_projects;

CREATE POLICY company_projects_rls
ON erp_map.company_projects
FOR ALL
USING (
  erp_meta.req_is_admin() = true
  OR (
      company_id = erp_meta.req_company_id()
      AND EXISTS (
          SELECT 1
          FROM erp_master.companies c
          WHERE c.id = erp_meta.req_company_id()
            AND c.status = 'ACTIVE'
      )
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR (
      company_id = erp_meta.req_company_id()
      AND EXISTS (
          SELECT 1
          FROM erp_master.companies c
          WHERE c.id = erp_meta.req_company_id()
            AND c.status = 'ACTIVE'
      )
  )
);

DROP POLICY IF EXISTS user_companies_rls ON erp_map.user_companies;

CREATE POLICY user_companies_rls
ON erp_map.user_companies
FOR ALL
USING (
  erp_meta.req_is_admin() = true
  OR (
      company_id = erp_meta.req_company_id()
      AND EXISTS (
          SELECT 1
          FROM erp_master.companies c
          WHERE c.id = erp_meta.req_company_id()
            AND c.status = 'ACTIVE'
      )
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR (
      company_id = erp_meta.req_company_id()
      AND EXISTS (
          SELECT 1
          FROM erp_master.companies c
          WHERE c.id = erp_meta.req_company_id()
            AND c.status = 'ACTIVE'
      )
  )
);

DROP POLICY IF EXISTS user_company_roles_rls ON erp_map.user_company_roles;

CREATE POLICY user_company_roles_rls
ON erp_map.user_company_roles
FOR ALL
USING (
  erp_meta.req_is_admin() = true
  OR (
      company_id = erp_meta.req_company_id()
      AND EXISTS (
          SELECT 1
          FROM erp_master.companies c
          WHERE c.id = erp_meta.req_company_id()
            AND c.status = 'ACTIVE'
      )
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR (
      company_id = erp_meta.req_company_id()
      AND EXISTS (
          SELECT 1
          FROM erp_master.companies c
          WHERE c.id = erp_meta.req_company_id()
            AND c.status = 'ACTIVE'
      )
  )
);

DROP POLICY IF EXISTS company_group_rls ON erp_map.company_group;

CREATE POLICY company_group_rls
ON erp_map.company_group
FOR ALL
USING (
  erp_meta.req_is_admin() = true
  OR (
      company_id = erp_meta.req_company_id()
      AND EXISTS (
          SELECT 1
          FROM erp_master.companies c
          WHERE c.id = erp_meta.req_company_id()
            AND c.status = 'ACTIVE'
      )
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR (
      company_id = erp_meta.req_company_id()
      AND EXISTS (
          SELECT 1
          FROM erp_master.companies c
          WHERE c.id = erp_meta.req_company_id()
            AND c.status = 'ACTIVE'
      )
  )
);

-- ============================================================
-- ERP_MAP.USER_PROJECTS  (SAP-STYLE INDIRECT)
-- ============================================================

DROP POLICY IF EXISTS user_projects_rls ON erp_map.user_projects;

CREATE POLICY user_projects_rls
ON erp_map.user_projects
FOR ALL
USING (
  erp_meta.req_is_admin() = true
  OR EXISTS (
      SELECT 1
      FROM erp_map.company_projects cp
      JOIN erp_master.companies c
        ON c.id = cp.company_id
      WHERE cp.project_id = user_projects.project_id
        AND cp.company_id = erp_meta.req_company_id()
        AND c.status = 'ACTIVE'
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR EXISTS (
      SELECT 1
      FROM erp_map.company_projects cp
      JOIN erp_master.companies c
        ON c.id = cp.company_id
      WHERE cp.project_id = user_projects.project_id
        AND cp.company_id = erp_meta.req_company_id()
        AND c.status = 'ACTIVE'
  )
);

-- ============================================================
-- ERP_MAP.USER_DEPARTMENTS
-- ============================================================

DROP POLICY IF EXISTS user_departments_rls ON erp_map.user_departments;

CREATE POLICY user_departments_rls
ON erp_map.user_departments
FOR ALL
USING (
  erp_meta.req_is_admin() = true
  OR EXISTS (
      SELECT 1
      FROM erp_master.departments d
      JOIN erp_master.companies c
        ON c.id = d.company_id
      WHERE d.id = user_departments.department_id
        AND d.company_id = erp_meta.req_company_id()
        AND c.status = 'ACTIVE'
  )
)
WITH CHECK (
  erp_meta.req_is_admin() = true
  OR EXISTS (
      SELECT 1
      FROM erp_master.departments d
      JOIN erp_master.companies c
        ON c.id = d.company_id
      WHERE d.id = user_departments.department_id
        AND d.company_id = erp_meta.req_company_id()
        AND c.status = 'ACTIVE'
  )
);

COMMIT;