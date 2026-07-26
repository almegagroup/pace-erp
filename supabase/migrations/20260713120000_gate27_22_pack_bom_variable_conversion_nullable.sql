/*
 * File-ID: 27.22.VERIFICATION-FIX
 * File-Path: supabase/migrations/20260713120000_gate27_22_pack_bom_variable_conversion_nullable.sql
 * Gate: 27.22
 * Domain: PRODUCTION
 * Purpose: Allow variable material UOM conversions to store no fixed factor.
 */

ALTER TABLE erp_master.material_uom_conversion
  ALTER COLUMN conversion_factor DROP NOT NULL;
