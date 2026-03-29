/*
 * File-ID: 6.6D
 * File-Path: supabase/migrations/20260410127000_gate6_6_6D_session_selected_work_company.sql
 * Gate: 6
 * Phase: 6
 * Domain: SESSION
 * Purpose: Persist the selected operational Work Company on each ERP session
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_core.sessions
  ADD COLUMN IF NOT EXISTS selected_company_id UUID NULL
    REFERENCES erp_master.companies(id)
    ON DELETE SET NULL;

COMMENT ON COLUMN erp_core.sessions.selected_company_id IS
'Selected runtime Work Company for this active session. Parent Company must never be used as the operational company selector.';

UPDATE erp_core.sessions AS s
SET selected_company_id = candidate.company_id
FROM (
  SELECT DISTINCT ON (uc.auth_user_id)
    uc.auth_user_id,
    uc.company_id
  FROM erp_map.user_companies AS uc
  ORDER BY uc.auth_user_id, uc.is_primary DESC, uc.created_at ASC
) AS candidate
WHERE s.auth_user_id = candidate.auth_user_id
  AND s.selected_company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_selected_company_id
ON erp_core.sessions (selected_company_id);

CREATE INDEX IF NOT EXISTS idx_sessions_auth_user_selected_company
ON erp_core.sessions (auth_user_id, selected_company_id);

COMMIT;
