/*
 * Migration: 20261016100000_erp_planning_material_requirement_policy
 * Purpose:   PO22 Requirement — Tab 2 "Material Settings" (owner brief 2026-10-16).
 *
 *   One planning policy per company × individual RM/PM material × effective
 *   date: Target / Critical coverage days and the planning MOQ with its source.
 *   * Per individual material, never per material group (owner B11).
 *   * Effective-dated: the policy used on date D = the current row with the
 *     latest effective_from <= D. Saving again for the same effective_from
 *     creates the next version of that row (append-only, history kept).
 *     Because a policy only has a start date, two policies of one material can
 *     never overlap.
 *   * MOQ source is explicit: VENDOR (supplier minimum), COMPANY (Procurement
 *     policy) or NONE (no fixed MOQ). Existing PO sizes are evidence only and
 *     are never written here automatically (owner B09).
 *   * Critical days are stored explicitly. The legacy sheet default
 *     ROUNDUP(Target / 2) is applied by the save function only when the caller
 *     leaves Critical blank.
 *
 *   Planning-only data. Never touches material master, material_plant_ext,
 *   PO, CSN, GRN, stock, production or GL records.
 *
 *   After applying (DEV or PROD): NOTIFY pgrst, 'reload schema'; reconcile
 *   schema_migrations to this file's version; run migration-integrity-check.
 */

BEGIN;

CREATE TABLE erp_planning.material_requirement_policy (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES erp_master.companies(id),
  material_id        uuid NOT NULL REFERENCES erp_master.material_master(id),
  effective_from     date NOT NULL,
  version_no         integer NOT NULL CHECK (version_no >= 1),
  is_current         boolean NOT NULL DEFAULT true,
  target_cov_days    numeric(9,2) CHECK (target_cov_days IS NULL OR target_cov_days >= 0),
  critical_cov_days  numeric(9,2) CHECK (critical_cov_days IS NULL OR critical_cov_days >= 0),
  moq_qty            numeric(18,6) CHECK (moq_qty IS NULL OR moq_qty >= 0),
  moq_uom_code       text,
  moq_source         text NOT NULL DEFAULT 'NONE' CHECK (moq_source IN ('VENDOR', 'COMPANY', 'NONE')),
  moq_active         boolean NOT NULL DEFAULT false,
  remarks            text CHECK (remarks IS NULL OR length(remarks) <= 500),
  source_system      text NOT NULL DEFAULT 'ERP_ENTRY'
                     CHECK (source_system IN ('ERP_ENTRY', 'LEGACY_GOOGLE_SHEETS')),
  source_ref         jsonb,
  save_batch_id      uuid NOT NULL,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_material_requirement_policy_version
    UNIQUE (company_id, material_id, effective_from, version_no),
  -- A quantity needs a unit; "no fixed MOQ" carries no quantity and is never active.
  CONSTRAINT ck_material_requirement_policy_moq_shape CHECK (
    (moq_qty IS NULL OR moq_uom_code IS NOT NULL)
    AND (moq_source <> 'NONE' OR (moq_qty IS NULL AND NOT moq_active))
    AND (NOT moq_active OR moq_qty IS NOT NULL)
  )
);

CREATE UNIQUE INDEX ux_material_requirement_policy_current
  ON erp_planning.material_requirement_policy (company_id, material_id, effective_from)
  WHERE is_current;
CREATE INDEX ix_material_requirement_policy_company
  ON erp_planning.material_requirement_policy (company_id, material_id, effective_from DESC)
  WHERE is_current;
CREATE INDEX ix_material_requirement_policy_history
  ON erp_planning.material_requirement_policy (company_id, material_id, created_at DESC);

COMMENT ON TABLE erp_planning.material_requirement_policy IS
  'PO22 Material Settings: Target/Critical coverage days and planning MOQ per company × individual RM/PM material, effective-dated, append-only versioned. Policy on date D = current row with latest effective_from <= D.';
COMMENT ON COLUMN erp_planning.material_requirement_policy.moq_source IS
  'VENDOR = supplier minimum, COMPANY = Procurement policy, NONE = no fixed MOQ. PO history is evidence only and is never written here automatically.';
COMMENT ON COLUMN erp_planning.material_requirement_policy.source_system IS
  'ERP_ENTRY for page edits; LEGACY_GOOGLE_SHEETS when the row came from the REQUIREMENT sheet paste-import (source_ref keeps the pasted row).';

-- Reuses the planning append-only guard (20261014150000): no DELETE, and the
-- only UPDATE allowed is retiring the current version (is_current true -> false).
CREATE TRIGGER trg_material_requirement_policy_append_only
  BEFORE UPDATE OR DELETE ON erp_planning.material_requirement_policy
  FOR EACH ROW EXECUTE FUNCTION erp_planning.guard_append_only();

ALTER TABLE erp_planning.material_requirement_policy ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON erp_planning.material_requirement_policy TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Atomic batch save (CLAUDE.md §8B). The backend has already checked that each
-- material belongs to the company's PO22 material universe; this function
-- re-checks every value it can check on its own.
-- p_rows: [{ material_id, effective_from, target_cov_days?, critical_cov_days?,
--            moq_qty?, moq_uom_code?, moq_source, moq_active?, remarks?,
--            source_ref? }]
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION erp_planning.save_material_requirement_policies(
  p_company_id    uuid,
  p_actor         uuid,
  p_rows          jsonb,
  p_source_system text DEFAULT 'ERP_ENTRY'
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, erp_planning, erp_master
AS $$
DECLARE
  v_batch     uuid := gen_random_uuid();
  v_row       jsonb;
  v_material  uuid;
  v_from      date;
  v_target    numeric;
  v_critical  numeric;
  v_moq       numeric;
  v_moq_uom   text;
  v_source    text;
  v_active    boolean;
  v_remarks   text;
  v_base_uom  text;
  v_type      text;
  v_current   erp_planning.material_requirement_policy%ROWTYPE;
  v_saved     integer := 0;
  v_unchanged integer := 0;
  v_seen      text[] := ARRAY[]::text[];
  v_key       text;
BEGIN
  IF p_company_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'MTS_REQ_POLICY_INVALID_INPUT: company and actor are required';
  END IF;
  IF p_source_system NOT IN ('ERP_ENTRY', 'LEGACY_GOOGLE_SHEETS') THEN
    RAISE EXCEPTION 'MTS_REQ_POLICY_INVALID_INPUT: unknown source system %', p_source_system;
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'MTS_REQ_POLICY_NO_ROWS: nothing to save';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_material := nullif(v_row->>'material_id', '')::uuid;
    v_from     := nullif(v_row->>'effective_from', '')::date;
    v_target   := nullif(v_row->>'target_cov_days', '')::numeric;
    v_critical := nullif(v_row->>'critical_cov_days', '')::numeric;
    v_moq      := nullif(v_row->>'moq_qty', '')::numeric;
    v_moq_uom  := nullif(upper(btrim(coalesce(v_row->>'moq_uom_code', ''))), '');
    v_source   := upper(coalesce(nullif(v_row->>'moq_source', ''), 'NONE'));
    v_active   := coalesce((v_row->>'moq_active')::boolean, false);
    v_remarks  := nullif(btrim(coalesce(v_row->>'remarks', '')), '');

    IF v_material IS NULL OR v_from IS NULL THEN
      RAISE EXCEPTION 'MTS_REQ_POLICY_INVALID_INPUT: material and effective date are required';
    END IF;
    v_key := v_material::text || '|' || v_from::text;
    IF v_key = ANY (v_seen) THEN
      RAISE EXCEPTION 'MTS_REQ_POLICY_DUPLICATE_ROW: material % appears twice for effective date %', v_material, v_from;
    END IF;
    v_seen := array_append(v_seen, v_key);

    SELECT m.base_uom_code, m.material_type INTO v_base_uom, v_type
    FROM erp_master.material_master m WHERE m.id = v_material;
    IF v_type IS NULL THEN
      RAISE EXCEPTION 'MTS_REQ_POLICY_MATERIAL_NOT_FOUND: %', v_material;
    END IF;
    IF v_type NOT IN ('RM', 'PM') THEN
      RAISE EXCEPTION 'MTS_REQ_POLICY_MATERIAL_TYPE: % is %, only RM / PM materials carry a requirement policy', v_material, v_type;
    END IF;
    IF (v_target IS NOT NULL AND v_target < 0) OR (v_critical IS NOT NULL AND v_critical < 0)
       OR (v_moq IS NOT NULL AND v_moq < 0) THEN
      RAISE EXCEPTION 'MTS_REQ_POLICY_NEGATIVE: values may not be negative (material %)', v_material;
    END IF;
    IF v_target IS NULL AND v_critical IS NOT NULL THEN
      RAISE EXCEPTION 'MTS_REQ_POLICY_TARGET_REQUIRED: Critical days need Target days (material %)', v_material;
    END IF;
    -- Legacy default Critical = ROUNDUP(Target / 2), only when left blank.
    IF v_target IS NOT NULL AND v_critical IS NULL THEN
      v_critical := ceil(v_target / 2);
    END IF;
    IF v_source NOT IN ('VENDOR', 'COMPANY', 'NONE') THEN
      RAISE EXCEPTION 'MTS_REQ_POLICY_MOQ_SOURCE: % is not VENDOR / COMPANY / NONE', v_source;
    END IF;
    IF v_source = 'NONE' AND (v_moq IS NOT NULL OR v_active) THEN
      RAISE EXCEPTION 'MTS_REQ_POLICY_MOQ_SHAPE: MOQ source NONE carries no quantity and cannot be active (material %)', v_material;
    END IF;
    IF v_moq IS NOT NULL AND v_moq_uom IS NULL THEN
      RAISE EXCEPTION 'MTS_REQ_POLICY_MOQ_UOM_REQUIRED: MOQ quantity needs a unit (material %)', v_material;
    END IF;
    IF v_active AND v_moq IS NULL THEN
      RAISE EXCEPTION 'MTS_REQ_POLICY_MOQ_SHAPE: an active MOQ needs a quantity (material %)', v_material;
    END IF;
    IF v_moq IS NULL THEN
      v_moq_uom := NULL;
    END IF;
    -- MOQ unit must be the base unit, MT for a KG-base material (owner rule
    -- 1 MT = 1000 KG, same as PO21), or a fixed (non-variable) master conversion.
    IF v_moq_uom IS NOT NULL AND upper(v_moq_uom) <> upper(v_base_uom)
       AND NOT (v_moq_uom = 'MT' AND upper(v_base_uom) = 'KG') AND NOT EXISTS (
      SELECT 1 FROM erp_master.material_uom_conversion c
      WHERE c.material_id = v_material
        AND coalesce(c.active, true)
        AND NOT coalesce(c.variable_conversion, false)
        AND coalesce(c.conversion_factor, 0) > 0
        AND ((upper(c.from_uom_code) = v_moq_uom AND upper(c.to_uom_code) = upper(v_base_uom))
          OR (upper(c.to_uom_code) = v_moq_uom AND upper(c.from_uom_code) = upper(v_base_uom)))
    ) THEN
      RAISE EXCEPTION 'MTS_REQ_POLICY_MOQ_UOM_INVALID: % has no verified conversion to base unit % (material %)', v_moq_uom, v_base_uom, v_material;
    END IF;
    IF v_target IS NULL AND v_moq IS NULL AND v_source = 'NONE' AND v_remarks IS NULL THEN
      RAISE EXCEPTION 'MTS_REQ_POLICY_EMPTY: nothing set for material %', v_material;
    END IF;

    SELECT * INTO v_current
    FROM erp_planning.material_requirement_policy
    WHERE company_id = p_company_id AND material_id = v_material
      AND effective_from = v_from AND is_current
    FOR UPDATE;

    IF v_current.id IS NOT NULL
       AND v_current.target_cov_days IS NOT DISTINCT FROM v_target
       AND v_current.critical_cov_days IS NOT DISTINCT FROM v_critical
       AND v_current.moq_qty IS NOT DISTINCT FROM v_moq
       AND v_current.moq_uom_code IS NOT DISTINCT FROM v_moq_uom
       AND v_current.moq_source = v_source
       AND v_current.moq_active = v_active
       AND v_current.remarks IS NOT DISTINCT FROM v_remarks THEN
      v_unchanged := v_unchanged + 1;
      CONTINUE;
    END IF;

    IF v_current.id IS NOT NULL THEN
      UPDATE erp_planning.material_requirement_policy SET is_current = false WHERE id = v_current.id;
    END IF;

    INSERT INTO erp_planning.material_requirement_policy (
      company_id, material_id, effective_from, version_no, is_current,
      target_cov_days, critical_cov_days, moq_qty, moq_uom_code, moq_source, moq_active,
      remarks, source_system, source_ref, save_batch_id, created_by
    ) VALUES (
      p_company_id, v_material, v_from, coalesce(v_current.version_no, 0) + 1, true,
      v_target, v_critical, v_moq, v_moq_uom, v_source, v_active,
      v_remarks, p_source_system, v_row->'source_ref', v_batch, p_actor
    );
    v_saved := v_saved + 1;
  END LOOP;

  RETURN jsonb_build_object('save_batch_id', v_batch, 'saved', v_saved, 'unchanged', v_unchanged);
END;
$$;

REVOKE ALL ON FUNCTION erp_planning.save_material_requirement_policies(uuid, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.save_material_requirement_policies(uuid, uuid, jsonb, text) TO service_role;

COMMIT;
