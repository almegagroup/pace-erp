-- ============================================================
-- File-ID: ID-6.6A
-- File-Path: supabase/migrations/20260211104000_gate6_6_6A_primary_company_rule.sql
-- Gate: 6
-- Phase: 6
-- Domain: MAP
-- Purpose: Deterministic primary company per user
-- Authority: Backend
-- ============================================================

BEGIN;

-- Only one primary company per user
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_primary_company
ON erp_map.user_companies (auth_user_id)
WHERE is_primary = true;

-- Helper: get_primary_company
CREATE OR REPLACE FUNCTION erp_map.get_primary_company(p_auth_user_id uuid)
RETURNS uuid
LANGUAGE sql
AS $$
  SELECT company_id
  FROM erp_map.user_companies
  WHERE auth_user_id = p_auth_user_id
    AND is_primary = true;
$$;

COMMENT ON FUNCTION erp_map.get_primary_company IS
'Returns deterministic primary company for HR + identity scope.';

COMMIT;
