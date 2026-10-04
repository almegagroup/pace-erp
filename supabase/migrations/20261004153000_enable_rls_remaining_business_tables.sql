/*
 * File-Path: supabase/migrations/20261004153000_enable_rls_remaining_business_tables.sql
 * Domain: DB Security
 * Purpose: Complete default-deny RLS enforcement on the remaining business tables.
 * Authority: Backend service-role API
 * Idempotent: YES
 */

BEGIN;

-- These tables are accessed only through the Edge API's service_role client.
-- Enabling RLS without a permissive user policy keeps that API path intact while
-- denying direct anon/authenticated access unless a narrow policy is added later.

ALTER TABLE IF EXISTS erp_inventory.physical_inventory_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_inventory.physical_inventory_block FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_inventory.posting_source_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_inventory.posting_source_registry FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_inventory.valuation_correction_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_inventory.valuation_correction_log FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_inventory.report_column_layout ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_inventory.report_column_layout FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_inventory.report_layout_default ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_inventory.report_layout_default FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_inventory.stock_status_change_posting ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_inventory.stock_status_change_posting FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_inventory.stock_history_bucket_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_inventory.stock_history_bucket_map FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_master.machine_po_type_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_master.machine_po_type_map FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS erp_procurement.physical_inventory_reopen_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.physical_inventory_reopen_log FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.deduction_type_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.deduction_type_master FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.sales_order_map_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.sales_order_map_allocation FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.delivery_challan_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.delivery_challan_source FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.sales_order_map_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.sales_order_map_group FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.delivery_challan_dispatch_amendment ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.delivery_challan_dispatch_amendment FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.manual_costing_rate_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.manual_costing_rate_entry FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.sales_return_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.sales_return_receipt FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.sales_return_invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.sales_return_invoice FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.sales_return_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.sales_return_item FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.sales_return_repack_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.sales_return_repack_line FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.purchase_order_crcp_company ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.purchase_order_crcp_company FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.stock_transfer_order_crcp_company ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.stock_transfer_order_crcp_company FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.landed_cost_deduction_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS erp_procurement.landed_cost_deduction_line FORCE ROW LEVEL SECURITY;

COMMIT;
