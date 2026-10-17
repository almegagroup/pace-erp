/*
 * REVIEW ONLY — NOT APPLIED
 *
 * PO22 Phase 3B additive persistence layer. This migration is committed for
 * schema/ACL review only; this task does not run it in DEV or PROD. It does
 * not change PO22 requirements, stock, reservation, PO, CSN, GRN, production,
 * or any operational document.
 *
 * Deployment sequence after separately approved review:
 * 1. apply in DEV; NOTIFY pgrst, 'reload schema'; run migration integrity;
 * 2. provision the companion ACL script using a NEW ACL version per company,
 *    capture source, generate/activate the ACL snapshot, rebuild user menus;
 * 3. validate after a separately authorized API/UI implementation.
 *
 * Rollback: remove only these empty planning tables/triggers after preserving
 * review evidence. Never rollback by changing operational supply records.
 */

BEGIN;

CREATE TABLE erp_planning.mts_optimizer_material_selection (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                   uuid NOT NULL REFERENCES erp_master.companies(id),
  material_id                  uuid NOT NULL REFERENCES erp_master.material_master(id),
  selection_month              date NOT NULL CHECK (date_trunc('month', selection_month)::date = selection_month),
  version_no                   integer NOT NULL CHECK (version_no >= 1),
  is_current                   boolean NOT NULL DEFAULT true,
  is_selected_for_new_purchase boolean NOT NULL,
  source_system                text NOT NULL DEFAULT 'ERP_ENTRY' CHECK (source_system IN ('ERP_ENTRY', 'MIGRATION_IMPORT')),
  source_ref                   jsonb,
  save_batch_id                uuid NOT NULL,
  created_by                   uuid NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mts_optimizer_selection_version
    UNIQUE (company_id, material_id, selection_month, version_no)
);

CREATE UNIQUE INDEX ux_mts_optimizer_selection_current
  ON erp_planning.mts_optimizer_material_selection (company_id, material_id, selection_month)
  WHERE is_current;
CREATE INDEX ix_mts_optimizer_selection_effective
  ON erp_planning.mts_optimizer_material_selection (company_id, selection_month DESC, material_id)
  WHERE is_current;

COMMENT ON TABLE erp_planning.mts_optimizer_material_selection IS
  'PO22 optimizer: owner-controlled, effective monthly eligibility for tentative NEW purchases only. It never removes posted physical stock or confirmed PO/CSN/GE supply from an input snapshot.';

-- Existing planning guard permits only current-row retirement and prevents
-- deletion, preserving the decision history used by a run snapshot.
CREATE TRIGGER trg_mts_optimizer_material_selection_append_only
  BEFORE UPDATE OR DELETE ON erp_planning.mts_optimizer_material_selection
  FOR EACH ROW EXECUTE FUNCTION erp_planning.guard_append_only();

CREATE TABLE erp_planning.mts_optimizer_input_snapshot (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                   uuid NOT NULL REFERENCES erp_master.companies(id),
  as_of_date                   date NOT NULL,
  captured_at                  timestamptz NOT NULL,
  source_contract_version      text NOT NULL,
  source_fingerprint           text NOT NULL,
  sha256_business_fingerprint  text NOT NULL CHECK (sha256_business_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  input_json                   jsonb NOT NULL,
  provenance_json              jsonb NOT NULL,
  blocker_count                integer NOT NULL DEFAULT 0 CHECK (blocker_count >= 0),
  created_by                   uuid,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mts_optimizer_input_snapshot_evidence
    UNIQUE (company_id, as_of_date, sha256_business_fingerprint),
  CONSTRAINT ck_mts_optimizer_input_snapshot_shape CHECK (
    jsonb_typeof(input_json) = 'object' AND jsonb_typeof(provenance_json) = 'object'
  )
);

CREATE INDEX ix_mts_optimizer_input_snapshot_company_as_of
  ON erp_planning.mts_optimizer_input_snapshot (company_id, as_of_date DESC, created_at DESC);

COMMENT ON TABLE erp_planning.mts_optimizer_input_snapshot IS
  'Immutable Phase 3B source-evidence snapshot for a future deterministic PO22 optimizer. It contains no allocation, Store instruction, transfer, recommendation, or PO action.';

-- Snapshots are evidence records and have no update/delete path.
CREATE OR REPLACE FUNCTION erp_planning.guard_mts_optimizer_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'MTS_OPTIMIZER_SNAPSHOT_IMMUTABLE: input snapshots cannot be updated or deleted';
END;
$$;

CREATE TRIGGER trg_mts_optimizer_input_snapshot_immutable
  BEFORE UPDATE OR DELETE ON erp_planning.mts_optimizer_input_snapshot
  FOR EACH ROW EXECUTE FUNCTION erp_planning.guard_mts_optimizer_snapshot_immutable();

ALTER TABLE erp_planning.mts_optimizer_material_selection ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_planning.mts_optimizer_input_snapshot ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON erp_planning.mts_optimizer_material_selection TO service_role;
GRANT SELECT, INSERT ON erp_planning.mts_optimizer_input_snapshot TO service_role;

COMMIT;
