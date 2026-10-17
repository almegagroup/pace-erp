-- §138.13.2 — release a free machine bucket allocation back to the same
-- shop-floor location's Unassigned bucket. This is attribution only: it must
-- never write stock_ledger, stock_snapshot, or reservation_document.
--
-- The function owns the final balance/reservation check and paired insert so
-- the browser can never release based on a stale IN03 snapshot. PROCESS_PO
-- reservations follow the existing Page-4 policy: they belong to their
-- Process PO machine; non-PROCESS_PO reservations remain location-wide.

BEGIN;

ALTER TABLE erp_production.machine_stock_log
  DROP CONSTRAINT IF EXISTS machine_stock_log_source_type_check;

ALTER TABLE erp_production.machine_stock_log
  ADD CONSTRAINT machine_stock_log_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'TRANSFER'::text,
    'CONSUMPTION'::text,
    'PID_ADJUSTMENT'::text,
    'MANUAL_ALLOT'::text,
    'MANUAL_RELEASE'::text,
    'AUTO_SINGLE_MACHINE_ALLOT'::text
  ]));

CREATE OR REPLACE FUNCTION erp_production.auto_assign_single_mts_machine_stock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  v_machine_id uuid;
BEGIN
  -- MANUAL_RELEASE intentionally remains in Unassigned even at a
  -- single-machine location. It is an explicit operator decision to make
  -- the quantity available for a later controlled distribution.
  IF NEW.machine_id IS NOT NULL
    OR NEW.source_type IN ('MANUAL_ALLOT', 'MANUAL_RELEASE', 'AUTO_SINGLE_MACHINE_ALLOT') THEN
    RETURN NEW;
  END IF;

  SELECT CASE
    WHEN COUNT(DISTINCT machine.id) = 1
      THEN (ARRAY_AGG(DISTINCT machine.id ORDER BY machine.id))[1]
    ELSE NULL
  END
  INTO v_machine_id
  FROM erp_master.machine_master AS machine
  WHERE machine.company_id = NEW.company_id
    AND machine.storage_location_id = NEW.storage_location_id
    AND machine.active = true
    AND EXISTS (
      SELECT 1
      FROM erp_master.machine_po_type_map AS type_map
      WHERE type_map.machine_id = machine.id
        AND type_map.po_type = 'MTS'
    );

  IF v_machine_id IS NOT NULL THEN
    NEW.machine_id := v_machine_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION erp_production.release_machine_stock_allocation(
  p_company_id uuid,
  p_storage_location_id uuid,
  p_material_id uuid,
  p_machine_id uuid,
  p_batch_number text,
  p_quantity numeric,
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'erp_production', 'erp_master', 'public', 'pg_catalog'
AS $function$
DECLARE
  v_machine_qty numeric := 0;
  v_open_reservation_qty numeric := 0;
  v_releasable_qty numeric := 0;
  v_reference_document_id uuid := gen_random_uuid();
BEGIN
  IF p_company_id IS NULL
    OR p_storage_location_id IS NULL
    OR p_material_id IS NULL
    OR p_machine_id IS NULL
    OR p_quantity IS NULL
    OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'LTR_MACHINE_RELEASE_INVALID';
  END IF;

  -- Serialise identical bucket releases while the live balance is checked.
  PERFORM pg_advisory_xact_lock(hashtext(
    p_company_id::text || ':' || p_storage_location_id::text || ':' ||
    p_material_id::text || ':' || p_machine_id::text || ':' || COALESCE(p_batch_number, '')
  ));

  IF NOT EXISTS (
    SELECT 1
    FROM erp_master.machine_master AS machine
    WHERE machine.id = p_machine_id
      AND machine.company_id = p_company_id
      AND machine.storage_location_id = p_storage_location_id
  ) THEN
    RAISE EXCEPTION 'LTR_MACHINE_RELEASE_MACHINE_LOCATION_MISMATCH';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN log.direction = 'OUT' THEN -log.qty ELSE log.qty END), 0)
    INTO v_machine_qty
  FROM erp_production.machine_stock_log AS log
  WHERE log.company_id = p_company_id
    AND log.storage_location_id = p_storage_location_id
    AND log.material_id = p_material_id
    AND log.machine_id = p_machine_id
    AND log.batch_number IS NOT DISTINCT FROM p_batch_number;

  SELECT COALESCE(SUM(reservation.balance_qty), 0)
    INTO v_open_reservation_qty
  FROM erp_production.reservation_document AS reservation
  LEFT JOIN erp_production.process_order AS process_order
    ON reservation.source_type = 'PROCESS_PO'
   AND process_order.id = reservation.source_id
  WHERE reservation.company_id = p_company_id
    AND reservation.storage_location_id = p_storage_location_id
    AND reservation.material_id = p_material_id
    AND reservation.status IN ('OPEN', 'PARTIAL')
    AND (
      reservation.source_type <> 'PROCESS_PO'
      OR (
        process_order.id IS NOT NULL
        AND process_order.machine_id IS NOT DISTINCT FROM p_machine_id
      )
    );

  v_releasable_qty := GREATEST(0, v_machine_qty - v_open_reservation_qty);
  IF p_quantity > v_releasable_qty THEN
    RAISE EXCEPTION 'LTR_MACHINE_RELEASE_QTY_EXCEEDS_FREE';
  END IF;

  INSERT INTO erp_production.machine_stock_log (
    company_id, storage_location_id, material_id, machine_id, batch_number,
    qty, direction, source_type, reference_document_type, reference_document_id, created_by
  ) VALUES
    (
      p_company_id, p_storage_location_id, p_material_id, p_machine_id, p_batch_number,
      p_quantity, 'OUT', 'MANUAL_RELEASE', 'MANUAL_RELEASE', v_reference_document_id, p_created_by
    ),
    (
      p_company_id, p_storage_location_id, p_material_id, NULL, p_batch_number,
      p_quantity, 'IN', 'MANUAL_RELEASE', 'MANUAL_RELEASE', v_reference_document_id, p_created_by
    );

  RETURN jsonb_build_object(
    'machine_qty_before_release', round(v_machine_qty, 6),
    'open_reservation_qty', round(v_open_reservation_qty, 6),
    'released_qty', round(p_quantity, 6),
    'releasable_qty_before_release', round(v_releasable_qty, 6),
    'reference_document_id', v_reference_document_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION erp_production.release_machine_stock_allocation(uuid, uuid, uuid, uuid, text, numeric, uuid) TO service_role;

COMMENT ON FUNCTION erp_production.release_machine_stock_allocation(uuid, uuid, uuid, uuid, text, numeric, uuid) IS
  '§138.13.2: atomically returns only free (unreserved) machine bucket quantity to the same S-location Unassigned bucket; paired MANUAL_RELEASE attribution only, never a stock movement.';

COMMIT;
