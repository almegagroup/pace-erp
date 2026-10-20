/*
 * Migration: 20261019120000_po22_planning_cost_inputs
 * Purpose:   PO22 planning inputs decided by the business owner on 2026-10-19
 *            (common:docs/po22-common/OWNER-DECISIONS-2026-10-19-REQUIREMENT-AND-GROUPS.md).
 *
 *   D4  vendor_material_info: MOQ, order multiple, delivery lot (+ their unit).
 *   D6  vendor_material_info: optional Booking Time (PO -> vendor dispatch days;
 *       blank = already included in the route lead time).
 *   D10 material_requirement_policy: per-item carrying Rate per base UOM,
 *       effective-dated with the rest of the policy (monthly carry-forward).
 *   D11 currency_exchange_rate: dated INR rates (AUTO fetch + MANUAL override);
 *       consignment_note.boe_exchange_rate (customs rate printed on the BOE);
 *       company_planning_finance: company interest % per year, effective-dated.
 *
 *   Planning/master data only. No stock, PO, CSN status, GRN or GL posting.
 *   After applying (DEV or PROD, owner approval required): NOTIFY pgrst,
 *   'reload schema'; reconcile schema_migrations to this file's version; run
 *   migration-integrity-check.
 */

BEGIN;

-- D4 / D6 ─ vendor × material supply terms ──────────────────────────────────
ALTER TABLE erp_master.vendor_material_info
  ADD COLUMN IF NOT EXISTS moq_qty            numeric(20,6) CHECK (moq_qty IS NULL OR moq_qty > 0),
  ADD COLUMN IF NOT EXISTS order_multiple_qty numeric(20,6) CHECK (order_multiple_qty IS NULL OR order_multiple_qty > 0),
  ADD COLUMN IF NOT EXISTS delivery_lot_qty   numeric(20,6) CHECK (delivery_lot_qty IS NULL OR delivery_lot_qty > 0),
  ADD COLUMN IF NOT EXISTS supply_uom_code    text,
  ADD COLUMN IF NOT EXISTS booking_time_days  integer CHECK (booking_time_days IS NULL OR booking_time_days >= 0);

ALTER TABLE erp_master.vendor_material_info
  DROP CONSTRAINT IF EXISTS ck_vendor_material_info_supply_uom;
ALTER TABLE erp_master.vendor_material_info
  ADD CONSTRAINT ck_vendor_material_info_supply_uom CHECK (
    (moq_qty IS NULL AND order_multiple_qty IS NULL AND delivery_lot_qty IS NULL) OR supply_uom_code IS NOT NULL
  );

COMMENT ON COLUMN erp_master.vendor_material_info.moq_qty IS 'Vendor minimum order quantity in supply_uom_code (PO22 D4).';
COMMENT ON COLUMN erp_master.vendor_material_info.order_multiple_qty IS 'Vendor order multiple in supply_uom_code; independent of MOQ (PO22 D4).';
COMMENT ON COLUMN erp_master.vendor_material_info.delivery_lot_qty IS 'Optional delivery lot size: one PO may arrive as several dated lots (PO22 D4).';
COMMENT ON COLUMN erp_master.vendor_material_info.booking_time_days IS 'Optional PO-to-vendor-dispatch days. Blank = 0 (already inside route lead time). Total lead time = booking + route (PO22 D6).';

-- D10 ─ per-item carrying Rate on the PO22 Material Settings policy ─────────
ALTER TABLE erp_planning.material_requirement_policy
  ADD COLUMN IF NOT EXISTS carrying_rate_per_uom numeric(18,6)
    CHECK (carrying_rate_per_uom IS NULL OR carrying_rate_per_uom >= 0);
COMMENT ON COLUMN erp_planning.material_requirement_policy.carrying_rate_per_uom IS
  'Physical carrying cost (INR per base UOM) added to landed cost; blank = landed cost only. Effective-dated with the policy row (PO22 D10/D11).';

-- D11 ─ dated exchange rates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_master.currency_exchange_rate (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_code text NOT NULL CHECK (currency_code = upper(currency_code) AND length(currency_code) = 3),
  rate_date     date NOT NULL,
  inr_per_unit  numeric(20,6) NOT NULL CHECK (inr_per_unit > 0),
  source        text NOT NULL CHECK (source IN ('AUTO', 'MANUAL')),
  provider      text,
  provider_rate_date date,
  remarks       text CHECK (remarks IS NULL OR length(remarks) <= 300),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_currency_exchange_rate UNIQUE (currency_code, rate_date, source)
);
CREATE INDEX IF NOT EXISTS ix_currency_exchange_rate_lookup
  ON erp_master.currency_exchange_rate (currency_code, rate_date DESC);
COMMENT ON TABLE erp_master.currency_exchange_rate IS
  'INR per one unit of a foreign currency by date. AUTO = fetched daily (provider + provider_rate_date kept); MANUAL = user override, wins over AUTO for the same date (PO22 D11).';
ALTER TABLE erp_master.currency_exchange_rate ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON erp_master.currency_exchange_rate TO service_role;

-- D11 ─ customs rate printed on the BOE ─────────────────────────────────────
ALTER TABLE erp_procurement.consignment_note
  ADD COLUMN IF NOT EXISTS boe_exchange_rate numeric(20,6) CHECK (boe_exchange_rate IS NULL OR boe_exchange_rate > 0);
COMMENT ON COLUMN erp_procurement.consignment_note.boe_exchange_rate IS
  'Customs exchange rate on the BOE (INR per unit of PO currency). Planning precedence: this > table rate on boe_date > today (PO22 D11).';

-- D11 ─ company interest % (money tied up) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_planning.company_planning_finance (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES erp_master.companies(id),
  effective_from        date NOT NULL,
  interest_pct_per_year numeric(7,4) NOT NULL CHECK (interest_pct_per_year >= 0 AND interest_pct_per_year <= 100),
  remarks               text CHECK (remarks IS NULL OR length(remarks) <= 300),
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_planning_finance UNIQUE (company_id, effective_from)
);
COMMENT ON TABLE erp_planning.company_planning_finance IS
  'Company interest % per year for PO22 cost comparison: financing = value x % x days from vendor cash-out to customer cash-in. Value on date D = row with latest effective_from <= D (PO22 D11).';
ALTER TABLE erp_planning.company_planning_finance ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON erp_planning.company_planning_finance TO service_role;

-- D10 ─ save function now also stores carrying_rate_per_uom ─────────────────
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
  v_rate      numeric;
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
    v_rate     := nullif(v_row->>'carrying_rate_per_uom', '')::numeric;

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
       OR (v_moq IS NOT NULL AND v_moq < 0) OR (v_rate IS NOT NULL AND v_rate < 0) THEN
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
    IF v_target IS NULL AND v_moq IS NULL AND v_source = 'NONE' AND v_remarks IS NULL AND v_rate IS NULL THEN
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
       AND v_current.remarks IS NOT DISTINCT FROM v_remarks
       AND v_current.carrying_rate_per_uom IS NOT DISTINCT FROM v_rate THEN
      v_unchanged := v_unchanged + 1;
      CONTINUE;
    END IF;

    IF v_current.id IS NOT NULL THEN
      UPDATE erp_planning.material_requirement_policy SET is_current = false WHERE id = v_current.id;
    END IF;

    INSERT INTO erp_planning.material_requirement_policy (
      company_id, material_id, effective_from, version_no, is_current,
      target_cov_days, critical_cov_days, moq_qty, moq_uom_code, moq_source, moq_active,
      remarks, carrying_rate_per_uom, source_system, source_ref, save_batch_id, created_by
    ) VALUES (
      p_company_id, v_material, v_from, coalesce(v_current.version_no, 0) + 1, true,
      v_target, v_critical, v_moq, v_moq_uom, v_source, v_active,
      v_remarks, v_rate, p_source_system, v_row->'source_ref', v_batch, p_actor
    );
    v_saved := v_saved + 1;
  END LOOP;

  RETURN jsonb_build_object('save_batch_id', v_batch, 'saved', v_saved, 'unchanged', v_unchanged);
END;
$$;

REVOKE ALL ON FUNCTION erp_planning.save_material_requirement_policies(uuid, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.save_material_requirement_policies(uuid, uuid, jsonb, text) TO service_role;

COMMIT;
