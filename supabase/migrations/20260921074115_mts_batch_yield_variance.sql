-- MTS Page 5 declares actual packed output per physical batch.  The Page 6
-- atomic create already persists the converted Packing POs and a creation
-- snapshot in one transaction.  This trigger runs inside that same transaction
-- and derives one immutable, pending QA yield-variance record per batch.
-- No stock or costing document is posted here; Verify owns that later step.

BEGIN;

CREATE TABLE IF NOT EXISTS erp_production.mts_batch_yield_variance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_order_id uuid NOT NULL
    REFERENCES erp_production.process_order(id) ON DELETE CASCADE,
  packing_order_id uuid NOT NULL
    REFERENCES erp_production.packing_order(id) ON DELETE RESTRICT,
  packing_plan_row_id uuid NOT NULL
    REFERENCES erp_production.mts_packing_plan_row(id) ON DELETE RESTRICT,
  batch_number text NOT NULL,
  sku_material_id uuid NOT NULL,
  expected_qty numeric NOT NULL CHECK (expected_qty > 0),
  declared_actual_qty numeric NOT NULL CHECK (declared_actual_qty >= 0),
  variance_qty numeric NOT NULL,
  variance_type text NOT NULL CHECK (variance_type IN ('GAIN', 'LOSS', 'NONE')),
  uom_code text NOT NULL DEFAULT 'KG',
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'POSTED', 'REVERSED')),
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid NULL,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mts_batch_yield_variance_process_batch_key UNIQUE (process_order_id, batch_number),
  CONSTRAINT mts_batch_yield_variance_amount_check
    CHECK (variance_qty = declared_actual_qty - expected_qty),
  CONSTRAINT mts_batch_yield_variance_type_check
    CHECK (
      (variance_qty > 0 AND variance_type = 'GAIN') OR
      (variance_qty < 0 AND variance_type = 'LOSS') OR
      (variance_qty = 0 AND variance_type = 'NONE')
    )
);

CREATE INDEX IF NOT EXISTS idx_mts_batch_yield_variance_packing_order
  ON erp_production.mts_batch_yield_variance (packing_order_id);

CREATE INDEX IF NOT EXISTS idx_mts_batch_yield_variance_pending
  ON erp_production.mts_batch_yield_variance (process_order_id)
  WHERE status = 'PENDING';

COMMENT ON TABLE erp_production.mts_batch_yield_variance IS
  'One Page-5 declared yield result for each physical MTS batch. Created atomically with Page-6 documents; PENDING has no stock or costing effect until MTS Verify posts it.';

COMMENT ON COLUMN erp_production.mts_batch_yield_variance.declared_actual_qty IS
  'Derived from Page-5 Outer Unit / Batch x the selected pack fill quantity for this physical batch.';

CREATE OR REPLACE FUNCTION erp_production.capture_mts_batch_yield_variance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = erp_production, public
AS $$
DECLARE
  v_process_order erp_production.process_order%ROWTYPE;
  v_captured_count integer;
BEGIN
  SELECT * INTO v_process_order
    FROM erp_production.process_order
    WHERE id = NEW.process_order_id
    FOR SHARE;

  IF NOT FOUND OR v_process_order.po_type <> 'MTS' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(v_process_order.number_of_batches, 0) <= 0
    OR COALESCE(v_process_order.planned_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'PROD_MTS_YIELD_VARIANCE_PROCESS_INVALID';
  END IF;

  /*
   * Page 3 creates a homogeneous prefix + numeric suffix sequence (for
   * example EV3437...EV3486).  Comparing the numeric suffix keeps EV999 to
   * EV1000 correct, unlike a lexical text comparison.
   */
  INSERT INTO erp_production.mts_batch_yield_variance (
    process_order_id, packing_order_id, packing_plan_row_id, batch_number,
    sku_material_id, expected_qty, declared_actual_qty, variance_qty,
    variance_type, uom_code, status,
    created_by, created_at, last_updated_by, last_updated_at
  )
  SELECT
    v_process_order.id,
    packing.id,
    plan.id,
    batch.batch_number,
    packing.material_id,
    quantities.expected_qty,
    quantities.declared_actual_qty,
    quantities.declared_actual_qty - quantities.expected_qty,
    CASE
      WHEN quantities.declared_actual_qty - quantities.expected_qty > 0 THEN 'GAIN'
      WHEN quantities.declared_actual_qty - quantities.expected_qty < 0 THEN 'LOSS'
      ELSE 'NONE'
    END,
    'KG',
    'PENDING',
    NEW.created_by, NEW.created_at, NEW.last_updated_by, NEW.last_updated_at
  FROM erp_production.mts_packing_plan_row AS plan
  JOIN erp_production.packing_order AS packing
    ON packing.id = plan.packing_order_id
  CROSS JOIN LATERAL (
    SELECT
      ROUND(v_process_order.planned_qty / v_process_order.number_of_batches, 6) AS expected_qty,
      ROUND(packing.fill_qty_per_pack * plan.outer_unit_per_batch, 6) AS declared_actual_qty
  ) AS quantities
  JOIN erp_production.batch_number_instance AS batch
    ON batch.company_id = v_process_order.company_id
   AND batch.source_process_order_id = v_process_order.id
   AND batch.po_type = 'MTS'
   AND batch.batch_number ~ '[0-9]+$'
   AND plan.batch_number_from ~ '[0-9]+$'
   AND plan.batch_number_to ~ '[0-9]+$'
   AND regexp_replace(batch.batch_number, '[0-9]+$', '') = regexp_replace(plan.batch_number_from, '[0-9]+$', '')
   AND substring(batch.batch_number FROM '([0-9]+)$')::numeric
       BETWEEN substring(plan.batch_number_from FROM '([0-9]+)$')::numeric
           AND substring(plan.batch_number_to FROM '([0-9]+)$')::numeric
  WHERE plan.process_order_id = v_process_order.id
    AND plan.status = 'CONVERTED'
  ON CONFLICT (process_order_id, batch_number) DO NOTHING;

  SELECT COUNT(*) INTO v_captured_count
    FROM erp_production.mts_batch_yield_variance
    WHERE process_order_id = v_process_order.id;

  IF v_captured_count <> v_process_order.number_of_batches THEN
    RAISE EXCEPTION 'PROD_MTS_YIELD_VARIANCE_BATCH_COVERAGE_INVALID';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_mts_batch_yield_variance ON erp_production.mts_creation_snapshot;
CREATE TRIGGER trg_capture_mts_batch_yield_variance
  AFTER INSERT ON erp_production.mts_creation_snapshot
  FOR EACH ROW
  EXECUTE FUNCTION erp_production.capture_mts_batch_yield_variance();

CREATE OR REPLACE FUNCTION erp_production.reverse_mts_batch_yield_variance_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = erp_production, public
AS $$
BEGIN
  IF OLD.po_type = 'MTS' AND NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' THEN
    UPDATE erp_production.mts_batch_yield_variance
      SET status = 'REVERSED', last_updated_by = NEW.last_updated_by, last_updated_at = now()
      WHERE process_order_id = NEW.id AND status = 'PENDING';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reverse_mts_batch_yield_variance_on_cancel ON erp_production.process_order;
CREATE TRIGGER trg_reverse_mts_batch_yield_variance_on_cancel
  AFTER UPDATE OF status ON erp_production.process_order
  FOR EACH ROW
  EXECUTE FUNCTION erp_production.reverse_mts_batch_yield_variance_on_cancel();

GRANT ALL ON erp_production.mts_batch_yield_variance TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
