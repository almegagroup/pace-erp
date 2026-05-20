/*
 * File-ID: 11.1
 * File-Path: supabase/migrations/20260509100000_gate11_11_1_create_erp_inventory_schema.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: Create the erp_inventory schema and grant service_role default access.
 * Authority: Backend
 */

BEGIN;

CREATE SCHEMA IF NOT EXISTS erp_inventory;

GRANT USAGE ON SCHEMA erp_inventory TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_inventory
  GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_inventory
  GRANT ALL ON SEQUENCES TO service_role;

COMMIT;
