/*
 * File-ID: 0.6
 * File-Path: supabase/migrations/20260122101000_gate0_0_6_create_erp_schemas.sql
 * Gate: 0
 * Phase: 0
 * Domain: DB
 * Purpose: Define and lock ERP Postgres schema namespaces
 * Authority: Backend
 */

BEGIN;

-- Main ERP data (users, companies, sessions later)
CREATE SCHEMA IF NOT EXISTS erp_core;

-- Roles, permissions, ACL engine data
CREATE SCHEMA IF NOT EXISTS erp_acl;

-- Audit & security logs (append-only later)
CREATE SCHEMA IF NOT EXISTS erp_audit;

-- Internal system metadata
CREATE SCHEMA IF NOT EXISTS erp_meta;

COMMIT;
