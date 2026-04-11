/*
 * File-ID: 10.2
 * File-Path: supabase/migrations/20260411163000_gate10_2_fix_generate_acl_snapshot_search_path.sql
 * Gate: 10
 * Phase: 10
 * Domain: SECURITY
 * Purpose: Re-assert fixed search_path on acl.generate_acl_snapshot after later function replacements triggered Security Advisor warning.
 * Authority: Backend
 */

BEGIN;

ALTER FUNCTION acl.generate_acl_snapshot(uuid, uuid)
  SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_map, erp_master, erp_menu, erp_meta;

COMMIT;
