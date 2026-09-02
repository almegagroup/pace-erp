/*
 * File-Path: supabase/migrations/20260901160000_security_advisor_hardening_phase3.sql
 * Gate: SECURITY
 * Phase: POST-L2
 * Domain: SECURITY
 * Purpose:
 *   Phase 3 of the recurring Supabase Advisor hardening pass (follows
 *   20260809193000_security_advisor_hardening_phase2.sql). Re-scanned
 *   both dev and prod via `get_advisors` + direct pg_proc/pg_policies
 *   checks on 2026-09-01 and found:
 *     1. rls_disabled_in_public (ERROR) on 2 tables never covered by any
 *        prior hardening migration: erp_master.customer_address,
 *        erp_master.additional_cost_category.
 *     2. anon/authenticated_security_definer_function_executable (WARN)
 *        on functions added after phase2 (save_ac01_grn_cost,
 *        reserve_process_order_materials, complete_partial_batch_reversal,
 *        close_ac06_month, auto_close_expired_ac06_months,
 *        resolve_ac06_dispatch_rate, verify_ac06_rate_scopes,
 *        get_stock_history, reopen_reservation_after_invoice_cancel,
 *        reconcile_pgi_reservation_issue_status) plus a legacy 3-param
 *        erp_menu.generate_menu_snapshot overload phase2 never targeted.
 *     3. function_search_path_mutable (WARN) on 7 functions never covered
 *        before, plus 5 functions phase2 DID fix that have since drifted
 *        back open in dev specifically (proconfig reset to null there
 *        while prod stayed correctly locked) -- re-asserted here since
 *        the fix is idempotent and safe to replay on both environments.
 *
 * Safety model (same as phase2):
 *   - Backend always uses service_role, which bypasses RLS and is
 *     unaffected by any REVOKE below.
 *   - Every function.search_path target was read via pg_get_functiondef()
 *     first and confirmed fully schema-qualified in its body (no bare
 *     table/function references), so SET search_path = '' cannot break
 *     them at runtime.
 *   - auto_close_expired_ac06_months() runs only via pg_cron (as
 *     postgres, a superuser -- unaffected by REVOKE), same precedent as
 *     auto_close_expired_procurement_plans() in 20260818011000.
 *   - Idempotent throughout: safe to re-run, safe on an environment where
 *     some items are already fixed.
 */

BEGIN;

-- ============================================================
-- PART 1: RLS backend-only policy for tables the advisor flagged
-- as rls_disabled_in_public, never covered before.
-- ============================================================

DO $$
DECLARE
  v_table text;
  v_schema text;
  v_name text;
  v_tables text[] := ARRAY[
    'erp_master.customer_address',
    'erp_master.additional_cost_category'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    v_schema := split_part(v_table, '.', 1);
    v_name := split_part(v_table, '.', 2);

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_schema, v_name);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = v_schema AND tablename = v_name AND policyname = 'backend_only'
    ) THEN
      EXECUTE format(
        'CREATE POLICY backend_only ON %I.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false)',
        v_schema, v_name
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- PART 2: Lock search_path. Functions verified schema-qualified
-- throughout their body via pg_get_functiondef() before this list
-- was written -- SET search_path = '' is safe for all of them.
-- ============================================================

ALTER FUNCTION erp_production.activate_stroke_po_type(uuid, uuid) SET search_path = '';
ALTER FUNCTION erp_production.assert_plan_feed_allocation_item_owner() SET search_path = '';
ALTER FUNCTION erp_procurement.assert_so_map_allocation_item_owner() SET search_path = '';
ALTER FUNCTION erp_inventory.complete_stock_status_change_action(uuid, jsonb, jsonb) SET search_path = '';
ALTER FUNCTION erp_production.share_stroke_master(uuid, text, boolean, uuid) SET search_path = '';
ALTER FUNCTION erp_inventory.stock_ledger_set_posted_columns() SET search_path = '';
ALTER FUNCTION erp_production.sync_stroke_self_applicability() SET search_path = '';

-- Re-assert phase2 fixes that drifted back open in dev (idempotent, no-op where already correct).
ALTER FUNCTION erp_inventory.derive_source_lot_ref() SET search_path = '';
ALTER FUNCTION erp_procurement.generate_company_doc_number(uuid, text) SET search_path = '';
ALTER FUNCTION public.generate_vendor_code() SET search_path = '';
ALTER FUNCTION erp_master.validate_fg_depot_code_row() SET search_path = '';
ALTER FUNCTION erp_master.validate_fg_dispatch_customer_address_row() SET search_path = '';
ALTER FUNCTION erp_menu.generate_menu_snapshot(uuid, uuid, uuid, text)
  SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_inventory, erp_map, erp_master, erp_menu, erp_meta, erp_procurement, erp_production;

-- Legacy 3-param overload phase2 never targeted; same broad path since it does the same cross-schema work.
ALTER FUNCTION erp_menu.generate_menu_snapshot(uuid, uuid, text)
  SET search_path = pg_catalog, public, acl, erp_acl, erp_audit, erp_cache, erp_core, erp_hr, erp_inventory, erp_map, erp_master, erp_menu, erp_meta, erp_procurement, erp_production;

-- ============================================================
-- PART 3: Revoke direct anon/authenticated execution from
-- backend-only SECURITY DEFINER functions. Re-grant service_role.
-- Includes functions added after phase2 plus the legacy
-- generate_menu_snapshot overload that was missed.
-- ============================================================

REVOKE EXECUTE ON FUNCTION erp_menu.generate_menu_snapshot(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_menu.generate_menu_snapshot(uuid, uuid, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_menu.generate_menu_snapshot(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_menu.generate_menu_snapshot(uuid, uuid, uuid, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_inventory.get_stock_history(uuid, date, date, text[], uuid[], uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_inventory.get_stock_history(uuid, date, date, text[], uuid[], uuid[])
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_procurement.reopen_reservation_after_invoice_cancel()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement.reopen_reservation_after_invoice_cancel()
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_procurement.save_ac01_grn_cost(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text, date,
  numeric, numeric, numeric, numeric, boolean, boolean, boolean, boolean, boolean, numeric
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement.save_ac01_grn_cost(
  uuid, uuid, numeric, uuid, text, date, numeric, jsonb, jsonb, text, date,
  numeric, numeric, numeric, numeric, boolean, boolean, boolean, boolean, boolean, numeric
) TO service_role;

REVOKE EXECUTE ON FUNCTION erp_production.auto_close_expired_ac06_months(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_production.auto_close_expired_ac06_months(date)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_production.close_ac06_month(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_production.close_ac06_month(uuid, uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_production.complete_partial_batch_reversal(uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_production.complete_partial_batch_reversal(uuid, jsonb, jsonb)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_production.reconcile_pgi_reservation_issue_status()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_production.reconcile_pgi_reservation_issue_status()
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_production.reserve_process_order_materials(uuid, uuid, date, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_production.reserve_process_order_materials(uuid, uuid, date, uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_production.resolve_ac06_dispatch_rate(uuid, date, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_production.resolve_ac06_dispatch_rate(uuid, date, uuid, uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_production.verify_ac06_rate_scopes(uuid, uuid[], uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_production.verify_ac06_rate_scopes(uuid, uuid[], uuid)
  TO service_role;

-- Re-assert phase2 grants that drifted back open in dev (idempotent).
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
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_inventory.post_stock_movement(
  text, date, date, text, uuid, uuid, uuid, numeric, text, numeric, text, text, uuid, uuid, text, text, text, text, text, uuid
) TO service_role;

REVOKE EXECUTE ON FUNCTION erp_inventory.stock_health_check(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_inventory.stock_health_check(date)
  TO service_role;

REVOKE EXECUTE ON FUNCTION erp_master.generate_parent_customer_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_master.generate_parent_customer_code()
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
