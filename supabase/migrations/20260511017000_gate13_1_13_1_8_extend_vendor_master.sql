/*
 * File-ID: 13.1.8
 * File-Path: supabase/migrations/20260511017000_gate13_1_13_1_8_extend_vendor_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Add indent_number_required flag to vendor_master for vendor indent tracking control.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_master.vendor_master
  ADD COLUMN IF NOT EXISTS indent_number_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_master.vendor_master.indent_number_required IS
'Sticky flag. When ON: all new POs with this vendor auto-set indent_required = true, and Vendor Indent Number field is shown on CSN. Set by SA. Overridable per PO by Procurement.';

COMMIT;
