/*
 * File-ID: 6.6F
 * File-Path: supabase/migrations/20260410132000_gate6_6_6F_work_context_lifecycle_backfill.sql
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Backfill lifecycle-driven work contexts and user mappings after SSOT runtime alignment
 * Authority: Backend
 */

BEGIN;

INSERT INTO erp_acl.work_contexts (
  company_id,
  work_context_code,
  work_context_name,
  description,
  department_id,
  is_system,
  is_active,
  created_at
)
SELECT
  c.id,
  'GENERAL_OPS',
  'General Operations',
  'Default company-wide operational work context.',
  NULL,
  true,
  true,
  now()
FROM erp_master.companies AS c
WHERE c.status = 'ACTIVE'
  AND c.company_kind = 'BUSINESS'
  AND NOT EXISTS (
    SELECT 1
    FROM erp_acl.work_contexts AS wc
    WHERE wc.company_id = c.id
      AND wc.work_context_code = 'GENERAL_OPS'
  );

INSERT INTO erp_acl.work_contexts (
  company_id,
  work_context_code,
  work_context_name,
  description,
  department_id,
  is_system,
  is_active,
  created_at
)
SELECT
  d.company_id,
  'DEPT_' || UPPER(TRIM(d.department_code)),
  d.department_name,
  'System work context for department ' || UPPER(TRIM(d.department_code)) || '.',
  d.id,
  true,
  true,
  now()
FROM erp_master.departments AS d
JOIN erp_master.companies AS c
  ON c.id = d.company_id
WHERE d.status = 'ACTIVE'
  AND c.status = 'ACTIVE'
  AND c.company_kind = 'BUSINESS'
  AND NOT EXISTS (
    SELECT 1
    FROM erp_acl.work_contexts AS wc
    WHERE wc.company_id = d.company_id
      AND wc.work_context_code = 'DEPT_' || UPPER(TRIM(d.department_code))
  );

INSERT INTO erp_acl.user_work_contexts (
  auth_user_id,
  company_id,
  work_context_id,
  is_primary,
  created_at
)
SELECT
  uc.auth_user_id,
  uc.company_id,
  wc.work_context_id,
  true,
  now()
FROM erp_map.user_companies AS uc
JOIN erp_master.companies AS c
  ON c.id = uc.company_id
JOIN erp_acl.work_contexts AS wc
  ON wc.company_id = uc.company_id
 AND wc.work_context_code = 'GENERAL_OPS'
WHERE c.status = 'ACTIVE'
  AND c.company_kind = 'BUSINESS'
  AND NOT EXISTS (
    SELECT 1
    FROM erp_acl.user_work_contexts AS uwc
    WHERE uwc.auth_user_id = uc.auth_user_id
      AND uwc.company_id = uc.company_id
      AND uwc.work_context_id = wc.work_context_id
  );

INSERT INTO erp_acl.user_work_contexts (
  auth_user_id,
  company_id,
  work_context_id,
  is_primary,
  created_at
)
SELECT
  ud.auth_user_id,
  d.company_id,
  wc.work_context_id,
  false,
  now()
FROM erp_map.user_departments AS ud
JOIN erp_master.departments AS d
  ON d.id = ud.department_id
JOIN erp_master.companies AS c
  ON c.id = d.company_id
JOIN erp_acl.work_contexts AS wc
  ON wc.company_id = d.company_id
 AND wc.department_id = d.id
WHERE d.status = 'ACTIVE'
  AND c.status = 'ACTIVE'
  AND c.company_kind = 'BUSINESS'
  AND NOT EXISTS (
    SELECT 1
    FROM erp_acl.user_work_contexts AS uwc
    WHERE uwc.auth_user_id = ud.auth_user_id
      AND uwc.company_id = d.company_id
      AND uwc.work_context_id = wc.work_context_id
  );

UPDATE erp_core.sessions AS s
SET selected_work_context_id = candidate.work_context_id
FROM (
  SELECT DISTINCT ON (uwc.auth_user_id, uwc.company_id)
    uwc.auth_user_id,
    uwc.company_id,
    uwc.work_context_id
  FROM erp_acl.user_work_contexts AS uwc
  ORDER BY uwc.auth_user_id, uwc.company_id, uwc.is_primary DESC, uwc.created_at ASC
) AS candidate
WHERE s.auth_user_id = candidate.auth_user_id
  AND s.selected_company_id = candidate.company_id
  AND s.selected_work_context_id IS NULL;

COMMIT;
