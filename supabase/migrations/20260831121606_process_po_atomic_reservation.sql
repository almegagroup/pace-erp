-- §8D-style atomic check+reserve for Process PO material reservation.
--
-- Found live 2026-08-31 (CMP006, PROC_PO create): the old TypeScript flow did
-- "SELECT stock_ledger + reservation_document to compute availability" THEN,
-- as a completely separate later step, "INSERT reservation_document rows" --
-- with no lock or transaction spanning the two. Two Process POs created
-- within the same window (this environment creates dozens per hour against
-- the same RM pool) could both pass their own availability check before
-- either one's reservation committed, over-committing the same physical
-- stock and producing a spurious PROD_PO_INSUFFICIENT_STOCK for whichever
-- request's reservation-insert lost the race -- even though the material
-- genuinely had enough stock moments earlier/later.
--
-- Fix: move the availability recompute + reservation insert into ONE
-- Postgres function, serialized per (company, material, storage_location)
-- via pg_advisory_xact_lock (sorted to avoid deadlocks across lines). This
-- mirrors the availability logic already in
-- process_order.handlers.ts's computeAvailabilityRows() (ledger UNRESTRICTED
-- net, minus OPEN/PARTIAL reservations, plus in-flight INT output credit) --
-- kept in sync deliberately, not a new policy.
--
-- Called AFTER process_order + process_order_line rows already exist (their
-- insert is pure metadata, not stock-affecting) so this function can read
-- the finalized line set straight from the table instead of re-serializing
-- it from TypeScript. On shortage it inserts nothing; the caller is
-- responsible for deleting the just-created PO/lines and surfacing the
-- shortage list via the existing formatShortageDetail() UUID->name resolver.
BEGIN;

CREATE OR REPLACE FUNCTION erp_production.reserve_process_order_materials(
  p_process_order_id uuid,
  p_company_id uuid,
  p_required_by_date date,
  p_created_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, erp_inventory, erp_master, public
AS $$
DECLARE
  v_pair RECORD;
  v_shortages jsonb;
  v_now timestamptz := now();
  v_inserted_count int;
BEGIN
  -- Serialize concurrent checks for the same (company, material, location)
  -- pair. Locks are released automatically at transaction end (xact-scoped),
  -- and taken in a deterministic sorted order so two Process POs needing the
  -- same two materials can never deadlock against each other.
  FOR v_pair IN
    SELECT DISTINCT COALESCE(pol.actual_material_id, pol.material_id) AS material_id,
           pol.issue_sloc_id AS storage_location_id
    FROM erp_production.process_order_line pol
    WHERE pol.process_order_id = p_process_order_id
      AND pol.issue_sloc_id IS NOT NULL
      AND pol.planned_qty > 0
    ORDER BY 1, 2
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_company_id::text || ':' || v_pair.material_id::text || ':' || v_pair.storage_location_id::text, 0)
    );
  END LOOP;

  -- Availability recompute happens AFTER the locks above are held, so this
  -- read reflects a state no concurrent reservation-insert can change out
  -- from under it for the same material+location.
  WITH needed AS (
    SELECT pol.id AS line_id,
           COALESCE(pol.actual_material_id, pol.material_id) AS material_id,
           pol.issue_sloc_id AS storage_location_id,
           pol.planned_qty AS qty,
           COALESCE(pol.uom_code, 'KG') AS uom_code
    FROM erp_production.process_order_line pol
    WHERE pol.process_order_id = p_process_order_id
      AND pol.issue_sloc_id IS NOT NULL
      AND pol.planned_qty > 0
  ),
  distinct_pairs AS (
    SELECT DISTINCT material_id, storage_location_id FROM needed
  ),
  ledger_avail AS (
    SELECT sl.material_id, sl.storage_location_id,
           SUM(CASE WHEN sl.direction = 'IN' THEN sl.quantity ELSE -sl.quantity END) AS qty
    FROM erp_inventory.stock_ledger sl
    JOIN distinct_pairs dp ON dp.material_id = sl.material_id AND dp.storage_location_id = sl.storage_location_id
    WHERE sl.company_id = p_company_id AND sl.stock_type_code = 'UNRESTRICTED'
    GROUP BY sl.material_id, sl.storage_location_id
  ),
  reserved AS (
    SELECT rd.material_id, rd.storage_location_id, SUM(rd.balance_qty) AS qty
    FROM erp_production.reservation_document rd
    JOIN distinct_pairs dp ON dp.material_id = rd.material_id AND dp.storage_location_id = rd.storage_location_id
    WHERE rd.company_id = p_company_id AND rd.status IN ('OPEN', 'PARTIAL')
    GROUP BY rd.material_id, rd.storage_location_id
  ),
  int_credit AS (
    SELECT po.material_id, sm.default_storage_location_id AS storage_location_id,
           SUM(COALESCE(po.actual_qty, po.planned_qty, 0)) AS qty
    FROM erp_production.process_order po
    JOIN erp_production.stroke_master sm ON sm.id = po.stroke_master_id
    JOIN erp_master.material_master mm ON mm.id = po.material_id AND mm.material_type = 'INT'
    JOIN distinct_pairs dp ON dp.material_id = po.material_id
    WHERE po.company_id = p_company_id
      AND po.po_type = 'INT'
      AND po.status IN ('STANDARD', 'QA_APPROVED', 'BATCH_STARTED', 'FINAL')
      AND sm.default_storage_location_id IS NOT NULL
    GROUP BY po.material_id, sm.default_storage_location_id
  ),
  availability AS (
    SELECT dp.material_id, dp.storage_location_id,
      GREATEST(0, COALESCE(la.qty, 0) - COALESCE(res.qty, 0) + COALESCE(ic.qty, 0)) AS available_qty
    FROM distinct_pairs dp
    LEFT JOIN ledger_avail la ON la.material_id = dp.material_id AND la.storage_location_id = dp.storage_location_id
    LEFT JOIN reserved res ON res.material_id = dp.material_id AND res.storage_location_id = dp.storage_location_id
    LEFT JOIN int_credit ic ON ic.material_id = dp.material_id AND ic.storage_location_id = dp.storage_location_id
  ),
  required AS (
    SELECT material_id, storage_location_id, SUM(qty) AS needed_qty
    FROM needed GROUP BY material_id, storage_location_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'material_id', r.material_id,
    'storage_location_id', r.storage_location_id,
    'needed_qty', r.needed_qty,
    'available_qty', COALESCE(a.available_qty, 0)
  ))
  INTO v_shortages
  FROM required r
  JOIN availability a ON a.material_id = r.material_id AND a.storage_location_id = r.storage_location_id
  WHERE COALESCE(a.available_qty, 0) < r.needed_qty - 0.0005;

  IF v_shortages IS NOT NULL AND jsonb_array_length(v_shortages) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'shortages', v_shortages);
  END IF;

  INSERT INTO erp_production.reservation_document (
    source_type, source_id, source_line_id, company_id, material_id, storage_location_id,
    required_qty, uom_code, required_by_date, status, created_by, created_at, last_updated_by, last_updated_at
  )
  SELECT 'PROCESS_PO', p_process_order_id, pol.id, p_company_id,
         COALESCE(pol.actual_material_id, pol.material_id), pol.issue_sloc_id,
         pol.planned_qty, COALESCE(pol.uom_code, 'KG'), p_required_by_date, 'OPEN',
         p_created_by, v_now, p_created_by, v_now
  FROM erp_production.process_order_line pol
  WHERE pol.process_order_id = p_process_order_id
    AND pol.issue_sloc_id IS NOT NULL
    AND pol.planned_qty > 0;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'reserved_count', v_inserted_count);
END;
$$;

GRANT EXECUTE ON FUNCTION erp_production.reserve_process_order_materials(uuid, uuid, date, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
