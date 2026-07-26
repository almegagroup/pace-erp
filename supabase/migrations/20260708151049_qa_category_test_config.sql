/*
 * File-Path: supabase/migrations/20260708151049_qa_category_test_config.sql
 * Domain: QUALITY (Inward QA redesign)
 * Purpose: Category Test Config — assigns a Test Method to a Material Category (within a
 *          company) with its own LSL/USL. This is what actually drives which methods show
 *          up when QA opens a GRN for a given material's category.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.qa_category_test_config (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cross-schema — plain uuid, NO FK
  company_id        uuid NOT NULL,

  -- Matches material_master.material_category free-text value (no formal category master
  -- exists for this QA grouping yet — see docs/Operation Management session notes 2026-07-08).
  material_category text NOT NULL,

  test_method_id    uuid NOT NULL
    REFERENCES erp_master.qa_test_method(id)
    ON DELETE RESTRICT,

  lsl               numeric(20, 6) NULL,
  usl               numeric(20, 6) NULL,

  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_updated_by   uuid NULL,
  last_updated_at   timestamptz NULL,

  UNIQUE (company_id, material_category, test_method_id)
);

COMMENT ON TABLE erp_master.qa_category_test_config IS
'Category-specific Inward QA test config. LSL/USL are always specific to (company, material_category, test_method) — the same test_method_id can have different LSL/USL under a different material_category. Create: QA_OFFICER+. Edit LSL/USL and delete: QA_MANAGER/DIRECTOR/SA only. Delete additionally requires test_group=MCT and no test result ever recorded against it (enforced by handler).';

CREATE INDEX IF NOT EXISTS idx_qa_cat_config_lookup ON erp_master.qa_category_test_config (company_id, material_category);
CREATE INDEX IF NOT EXISTS idx_qa_cat_config_method ON erp_master.qa_category_test_config (test_method_id);
CREATE INDEX IF NOT EXISTS idx_qa_cat_config_active ON erp_master.qa_category_test_config (is_active);

GRANT SELECT ON erp_master.qa_category_test_config TO authenticated;
GRANT ALL    ON erp_master.qa_category_test_config TO service_role;

COMMIT;
