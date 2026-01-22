/*
 * File-ID: 0.6E
 * File-Path: supabase/migrations/20260122105000_gate0_0_6E_anon_authenticated_lockdown.sql
 * Gate: 0
 * Phase: 0
 * Domain: DB
 * Purpose: Fully lock down ERP schemas from anon and authenticated roles
 * Authority: Backend
 */

BEGIN;

-- Revoke any accidental schema access
REVOKE ALL ON SCHEMA erp_core FROM anon, authenticated;
REVOKE ALL ON SCHEMA erp_acl FROM anon, authenticated;
REVOKE ALL ON SCHEMA erp_audit FROM anon, authenticated;
REVOKE ALL ON SCHEMA erp_meta FROM anon, authenticated;

-- Revoke any accidental table privileges (future-proof)
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA erp_core FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA erp_acl FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA erp_audit FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA erp_meta FROM anon, authenticated;

-- Revoke sequences (if any created in future)
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA erp_core FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA erp_acl FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA erp_audit FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA erp_meta FROM anon, authenticated;

COMMIT;
