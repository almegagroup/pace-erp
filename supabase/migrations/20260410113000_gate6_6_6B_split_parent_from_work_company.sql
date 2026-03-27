/*
 * File-ID: 6.6B
 * File-Path: supabase/migrations/20260410113000_gate6_6_6B_split_parent_from_work_company.sql
 * Gate: 6
 * Phase: 6
 * Domain: MAP
 * Purpose: Separate Parent Company truth from Work Company scope while preserving get_primary_company authority contract.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_map.user_parent_companies (
  auth_user_id UUID PRIMARY KEY
    REFERENCES erp_core.users(auth_user_id)
    ON DELETE CASCADE,

  company_id UUID NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_map.user_parent_companies IS
'Exact HR parent company truth per user. Separate from operational work-company scope.';

-- ------------------------------------------------------------
-- Backfill from legacy primary-company rows if present
-- ------------------------------------------------------------
INSERT INTO erp_map.user_parent_companies (auth_user_id, company_id)
SELECT uc.auth_user_id, uc.company_id
FROM erp_map.user_companies uc
WHERE uc.is_primary = TRUE
ON CONFLICT (auth_user_id) DO NOTHING;

-- ------------------------------------------------------------
-- Preserve existing function contract name, but switch source
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION erp_map.get_primary_company(p_auth_user_id uuid)
RETURNS uuid
LANGUAGE sql
AS $$
  SELECT company_id
  FROM erp_map.user_parent_companies
  WHERE auth_user_id = p_auth_user_id;
$$;

COMMENT ON FUNCTION erp_map.get_primary_company IS
'Returns deterministic parent company for HR + identity scope. Source is user_parent_companies.';

COMMIT;
