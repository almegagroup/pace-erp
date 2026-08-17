-- Fix rls_disabled_in_public advisor findings (ERROR level).
-- Same backend_only pattern already used everywhere else in this schema
-- (deny all to public, service_role bypasses RLS entirely so the API layer
-- is unaffected). Found live via Supabase advisor + direct pg_tables check
-- 2026-08-18: 18 tables missing RLS entirely in dev, plus 2
-- (sto_amendment_log, sto_approval_log) missing it even in prod despite the
-- advisor not flagging them there.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op if already enabled;
-- DROP POLICY IF EXISTS + CREATE POLICY is safe to re-run on tables that
-- already have the correct policy. Safe to apply to both dev and prod
-- regardless of each table's current per-environment state.

BEGIN;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('erp_master', 'reference_date_types'),
      ('erp_master', 'vendor_banks'),
      ('erp_master', 'material_vendor_doc_name'),
      ('erp_master', 'qa_category_test_config'),
      ('erp_master', 'qa_test_method'),
      ('erp_master', 'material_type_category'),
      ('erp_master', 'fg_parent_company'),
      ('erp_master', 'fg_depot_code'),
      ('erp_master', 'fg_dispatch_customer_address'),
      ('erp_master', 'fg_dispatch_customer'),
      ('erp_procurement', 'sto_approval_log'),
      ('erp_procurement', 'sto_amendment_log'),
      ('erp_procurement', 'csn_tracker_layout'),
      ('erp_procurement', 'csn_field_history'),
      ('erp_procurement', 'print_log'),
      ('erp_production', 'sfg_qa_document'),
      ('erp_production', 'sfg_qa_test_line'),
      ('erp_production', 'sfg_qa_decision_line')
    ) AS x(schema_name, table_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = t.schema_name AND table_name = t.table_name
    ) THEN
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schema_name, t.table_name);
      EXECUTE format('DROP POLICY IF EXISTS backend_only ON %I.%I', t.schema_name, t.table_name);
      EXECUTE format(
        'CREATE POLICY backend_only ON %I.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false)',
        t.schema_name, t.table_name
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
