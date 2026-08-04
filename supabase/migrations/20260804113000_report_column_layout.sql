/*
 * File-Path: supabase/migrations/20260804113000_report_column_layout.sql
 * Purpose: Shared report column layout persistence for procurement inventory reports.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.report_column_layout (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_code text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('GLOBAL', 'USER')),
  owner_user_id uuid NULL,
  layout_name text NOT NULL,
  visible_columns jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_column_layout_owner_ck
    CHECK (
      (scope = 'GLOBAL' AND owner_user_id IS NULL)
      OR (scope = 'USER' AND owner_user_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_report_column_layout_report_code
  ON erp_inventory.report_column_layout (report_code);

CREATE INDEX IF NOT EXISTS idx_report_column_layout_scope_owner
  ON erp_inventory.report_column_layout (report_code, scope, owner_user_id);

CREATE TABLE IF NOT EXISTS erp_inventory.report_layout_default (
  auth_user_id uuid NOT NULL,
  report_code text NOT NULL,
  layout_id uuid NOT NULL REFERENCES erp_inventory.report_column_layout(id),
  PRIMARY KEY (auth_user_id, report_code)
);

CREATE INDEX IF NOT EXISTS idx_report_layout_default_layout_id
  ON erp_inventory.report_layout_default (layout_id);

COMMENT ON TABLE erp_inventory.report_column_layout IS
  'Saved visible-column layouts for report pages such as IN02 and IN03.';

COMMENT ON TABLE erp_inventory.report_layout_default IS
  'Per-user default report layout selection by report_code.';

COMMIT;
