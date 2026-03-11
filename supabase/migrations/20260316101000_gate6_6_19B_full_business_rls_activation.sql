/*
 * File-ID: 6.19B
 * File-Path: supabase/migrations/20260316101000_gate6_6_19B_full_structural_rls_activation.sql
 * Gate: 6
 * Phase: 6
 * Domain: DB
 * Purpose: Enforce ENABLE + FORCE RLS on ALL ERP tables (structural activation only)
 * Authority: Backend
 * Idempotent: YES
 */

BEGIN;

-- ============================================================
-- ERP MASTER TABLES
-- ============================================================

ALTER TABLE IF EXISTS erp_master.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_master.companies FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_master.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_master.projects FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_master.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_master.departments FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_master.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_master.groups FORCE ROW LEVEL SECURITY;

-- ============================================================
-- ERP MAP TABLES
-- ============================================================

ALTER TABLE IF EXISTS erp_map.company_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_map.company_projects FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_map.user_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_map.user_companies FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_map.user_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_map.user_projects FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_map.user_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_map.user_departments FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_map.company_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_map.company_group FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_map.user_company_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_map.user_company_roles FORCE ROW LEVEL SECURITY;

-- ============================================================
-- ERP CORE TABLES
-- ============================================================

ALTER TABLE IF EXISTS erp_core.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_core.users FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_core.signup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_core.signup_requests FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_core.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_core.sessions FORCE ROW LEVEL SECURITY;

-- ============================================================
-- ERP MENU TABLES
-- ============================================================

ALTER TABLE IF EXISTS erp_menu.menu_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_menu.menu_master FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_menu.menu_tree ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_menu.menu_tree FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_menu.menu_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_menu.menu_snapshot FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_menu.menu_snapshot_refresh_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_menu.menu_snapshot_refresh_rules FORCE ROW LEVEL SECURITY;

-- ============================================================
-- ACL TABLES (CRITICAL HARDENING)
-- ============================================================

ALTER TABLE IF EXISTS acl.acl_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.acl_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.approver_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.approver_map FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.capabilities FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.capability_menu_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.capability_menu_actions FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.capability_precedence_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.capability_precedence_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.company_module_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.company_module_map FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.company_module_deny_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.company_module_deny_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.menu_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.menu_master FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.menu_tree ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.menu_tree FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.menu_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.menu_actions FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.role_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.role_capabilities FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.role_menu_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.role_menu_permissions FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.user_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.user_overrides FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS acl.user_override_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.user_override_audit FORCE ROW LEVEL SECURITY;

-- Snapshot table already enforced but ensure consistency

ALTER TABLE IF EXISTS acl.precomputed_acl_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS acl.precomputed_acl_view FORCE ROW LEVEL SECURITY;

COMMIT;