/*
 * File-Path: supabase/migrations/20260809193000_security_advisor_hardening_phase2.sql
 * Gate: SECURITY
 * Phase: POST-L2
 * Domain: SECURITY
 * Purpose:
 *   - Resolve the current Supabase Advisor findings for:
 *       1. rls_enabled_no_policy
 *       2. rls_disabled_in_public
 *       3. function_search_path_mutable
 *       4. anon/authenticated executable SECURITY DEFINER RPCs that are backend-only
 *
 * Safety model:
 *   - The application backend uses service_role for DB access.
 *   - service_role bypasses RLS, so backend/Codex/MCP flows continue to work.
 *   - These tables/functions are treated as backend-only surfaces; direct PostgREST access
 *     by anon/authenticated is denied explicitly.
 */

BEGIN;

-- ============================================================
-- PART 1: Explicit backend-only policies for procurement tables
-- that already have RLS enabled but no policies.
-- ============================================================

DO $$
DECLARE
  v_table text;
  v_schema text;
  v_name text;
  v_tables text[] := ARRAY[
    'erp_procurement.company_doc_number_counter',
    'erp_procurement.company_doc_number_series',
    'erp_procurement.consignment_note',
    'erp_procurement.debit_note',
    'erp_procurement.delivery_challan',
    'erp_procurement.delivery_challan_line',
    'erp_procurement.document_number_series',
    'erp_procurement.exchange_reference',
    'erp_procurement.gate_entry',
    'erp_procurement.gate_entry_line',
    'erp_procurement.gate_exit_inbound',
    'erp_procurement.gate_exit_outbound',
    'erp_procurement.goods_receipt',
    'erp_procurement.goods_receipt_line',
    'erp_procurement.invoice_number_series',
    'erp_procurement.invoice_verification',
    'erp_procurement.invoice_verification_line',
    'erp_procurement.inward_qa_decision_line',
    'erp_procurement.inward_qa_document',
    'erp_procurement.inward_qa_test_line',
    'erp_procurement.landed_cost',
    'erp_procurement.landed_cost_line',
    'erp_procurement.opening_stock_document',
    'erp_procurement.opening_stock_line',
    'erp_procurement.physical_inventory_document',
    'erp_procurement.physical_inventory_item',
    'erp_procurement.plant_transfer_order',
    'erp_procurement.po_amendment_log',
    'erp_procurement.po_approval_log',
    'erp_procurement.po_order_group',
    'erp_procurement.purchase_order',
    'erp_procurement.purchase_order_line',
    'erp_procurement.return_to_vendor',
    'erp_procurement.return_to_vendor_line',
    'erp_procurement.sales_invoice',
    'erp_procurement.sales_invoice_line',
    'erp_procurement.sales_order',
    'erp_procurement.sales_order_line',
    'erp_procurement.stock_transfer_order',
    'erp_procurement.stock_transfer_order_line'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    v_schema := split_part(v_table, '.', 1);
    v_name := split_part(v_table, '.', 2);

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_schema, v_name);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = v_schema
        AND tablename = v_name
        AND policyname = 'backend_only'
    ) THEN
      EXECUTE format(
        'CREATE POLICY backend_only ON %I.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false)',
        v_schema,
        v_name
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- PART 2: Enable RLS + explicit backend-only policies for
-- publicly exposed tables still missing RLS.
-- ============================================================

DO $$
DECLARE
  v_table text;
  v_schema text;
  v_name text;
  v_tables text[] := ARRAY[
    'erp_master.reference_date_types',
    'erp_master.vendor_banks',
    'erp_master.material_type_category',
    'erp_procurement.csn_tracker_layout',
    'erp_procurement.csn_field_history',
    'erp_master.material_vendor_doc_name',
    'erp_master.qa_test_method',
    'erp_master.qa_category_test_config',
    'erp_production.sfg_qa_document',
    'erp_production.sfg_qa_test_line',
    'erp_production.sfg_qa_decision_line',
    'erp_master.fg_parent_company',
    'erp_master.fg_depot_code',
    'erp_master.fg_dispatch_customer_address',
    'erp_master.fg_dispatch_customer',
    'erp_procurement.print_log',
    'erp_procurement.planning_sloc_group',
    'erp_procurement.planning_sloc_group_member',
    'erp_procurement.procurement_monthly_plan',
    'erp_procurement.procurement_monthly_plan_line',
    'erp_procurement.procurement_monthly_plan_archive',
    'erp_procurement.procurement_monthly_plan_archive_line',
    'erp_procurement.planning_item_group',
    'erp_procurement.procurement_monthly_plan_group_config',
    'erp_procurement.procurement_monthly_plan_archive_group_config'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    v_schema := split_part(v_table, '.', 1);
    v_name := split_part(v_table, '.', 2);

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_schema, v_name);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = v_schema
        AND tablename = v_name
        AND policyname = 'backend_only'
    ) THEN
      EXECUTE format(
        'CREATE POLICY backend_only ON %I.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false)',
        v_schema,
        v_name
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- PART 3: Lock search_path on the remaining mutable functions.
-- ============================================================

ALTER FUNCTION erp_menu.generate_menu_snapshot(uuid, uuid, uuid, text)
  SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_inventory, erp_map, erp_master, erp_menu, erp_meta, erp_procurement, erp_production;

ALTER FUNCTION erp_master.generate_material_pace_code(text)
  SET search_path = '';

ALTER FUNCTION erp_procurement.generate_company_doc_number(uuid, text)
  SET search_path = '';

ALTER FUNCTION public.generate_vendor_code()
  SET search_path = '';

ALTER FUNCTION erp_inventory.derive_source_lot_ref()
  SET search_path = '';

ALTER FUNCTION erp_master.validate_fg_depot_code_row()
  SET search_path = '';

ALTER FUNCTION erp_master.validate_fg_dispatch_customer_address_row()
  SET search_path = '';

-- ============================================================
-- PART 4: Revoke direct anon/authenticated execution from
-- backend-only SECURITY DEFINER functions. Re-grant service_role.
-- ============================================================

REVOKE EXECUTE ON FUNCTION erp_inventory.generate_material_doc_number(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_inventory.generate_material_doc_number(uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_inventory.generate_year_scoped_doc_number(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_inventory.generate_year_scoped_doc_number(uuid, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_inventory.post_stock_movement(
  text, date, date, text, uuid, uuid, uuid, numeric, text, numeric, text, text, uuid, uuid, text, text, text, text, text, uuid
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_inventory.post_stock_movement(
  text, date, date, text, uuid, uuid, uuid, numeric, text, numeric, text, text, uuid, uuid, text, text, text, text, text, uuid
)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_inventory.stock_health_check(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_inventory.stock_health_check(date)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_master.generate_parent_customer_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_master.generate_parent_customer_code()
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_menu.generate_menu_snapshot(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_menu.generate_menu_snapshot(uuid, uuid, uuid, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_production.resolve_conversion_rate(uuid, text, uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_production.resolve_conversion_rate(uuid, text, uuid, date)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.generate_cha_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_cha_code()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.generate_customer_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_customer_code()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.generate_material_category_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_material_category_code()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.generate_material_pace_code(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_material_pace_code(text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.generate_parent_customer_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_parent_customer_code()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.generate_payment_terms_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_payment_terms_code()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.generate_port_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_port_code()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.generate_transporter_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_transporter_code()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.generate_vendor_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_vendor_code()
  TO service_role;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
