/*
 * File-Path: supabase/migrations/20260924100000_so01_vendor_code_header.sql
 * Gate: 27.28 (SO01 follow-up)
 * Domain: PROCUREMENT / SALES
 * Purpose: Header-level Vendor Code on Sales Order (§141). One SO never uses
 *          two vendor codes, so this lives on sales_order, not the line.
 *          Mandatory only when Material Type includes FG/SFG AND the
 *          resolved Bill-To is Asian Paints (bill_to_type != 'CUSTOMER') --
 *          enforced in application code (createSalesOrderUnifiedHandler),
 *          left nullable here since RM/PM/INT-only and non-Asian-billed SOs
 *          never need it.
 * Authority: Backend / DB
 */

ALTER TABLE erp_procurement.sales_order
  ADD COLUMN IF NOT EXISTS vendor_code_id uuid NULL
  REFERENCES erp_production.vendor_code_master(id);

COMMENT ON COLUMN erp_procurement.sales_order.vendor_code_id IS
  'Asian-Paints-assigned Vendor Code this SO is dispatched under (feasibility §140/§141). Header-level -- one SO never mixes two. Mandatory (app-enforced) when material_types includes FG/SFG and bill_to_type != CUSTOMER (i.e. Bill-To resolves to Asian Paints); NULL otherwise.';

CREATE INDEX IF NOT EXISTS ix_sales_order_vendor_code_id
  ON erp_procurement.sales_order (vendor_code_id) WHERE vendor_code_id IS NOT NULL;
