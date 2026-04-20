/*
 * File-ID: PHASE3A-SESSION-WORKSPACE-MODE
 * File-Path: supabase/migrations/20260420100000_phase3a_session_workspace_mode.sql
 * Gate: 9
 * Phase: 3A
 * Domain: SESSION
 * Purpose: Add workspace_mode hint column to erp_core.sessions for operator type detection.
 *          SINGLE = one company. MULTI = two or more companies.
 *          This is a non-authoritative hint written at login time.
 *          Never used for ACL or authorization decisions.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_core.sessions
  ADD COLUMN IF NOT EXISTS workspace_mode TEXT NULL
    CHECK (workspace_mode IN ('SINGLE', 'MULTI'));

COMMENT ON COLUMN erp_core.sessions.workspace_mode IS
'Non-authoritative operator type hint derived at login from live company count.
SINGLE = user belongs to exactly one active BUSINESS company.
MULTI  = user belongs to two or more active BUSINESS companies.
Written once at session creation. Never re-derived mid-session.
Must never be used for ACL enforcement or authorization decisions.
Consumed only by shell and menu layer for UI mode selection.';

COMMIT;
