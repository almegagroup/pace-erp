-- MTS machine-stock attribution: when a company/shop-floor location has exactly
-- one active MTS-capable machine, stock never needs an Unassigned stopover.
-- The trigger applies the rule to every ordinary machine_stock_log writer
-- (transfer, PID adjustment, reversal, etc.). Manual and system allocation
-- pairs remain untouched so their source bucket is preserved accurately.

ALTER TABLE erp_production.machine_stock_log
  DROP CONSTRAINT IF EXISTS machine_stock_log_source_type_check;

ALTER TABLE erp_production.machine_stock_log
  ADD CONSTRAINT machine_stock_log_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'TRANSFER'::text,
    'CONSUMPTION'::text,
    'PID_ADJUSTMENT'::text,
    'MANUAL_ALLOT'::text,
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
  IF NEW.machine_id IS NOT NULL
    OR NEW.source_type IN ('MANUAL_ALLOT', 'AUTO_SINGLE_MACHINE_ALLOT') THEN
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

COMMENT ON FUNCTION erp_production.auto_assign_single_mts_machine_stock() IS
  'Assigns MTS shop-floor stock directly to its sole active MTS machine. Leaves stock Unassigned once two or more active MTS machines share the location.';

DROP TRIGGER IF EXISTS machine_stock_log_auto_assign_single_mts_machine
  ON erp_production.machine_stock_log;

CREATE TRIGGER machine_stock_log_auto_assign_single_mts_machine
BEFORE INSERT ON erp_production.machine_stock_log
FOR EACH ROW
EXECUTE FUNCTION erp_production.auto_assign_single_mts_machine_stock();

-- Preserve the machine-stock audit trail: existing balances are not rewritten.
-- Instead, each positive Unassigned bucket at a currently single-machine MTS
-- location receives a paired system attribution move (OUT Unassigned / IN sole
-- machine). Locations with two or more machines deliberately remain manual.
WITH single_mts_machine AS (
  SELECT
    machine.company_id,
    machine.storage_location_id,
    (ARRAY_AGG(DISTINCT machine.id ORDER BY machine.id))[1] AS machine_id
  FROM erp_master.machine_master AS machine
  WHERE machine.active = true
    AND machine.storage_location_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM erp_master.machine_po_type_map AS type_map
      WHERE type_map.machine_id = machine.id
        AND type_map.po_type = 'MTS'
    )
  GROUP BY machine.company_id, machine.storage_location_id
  HAVING COUNT(DISTINCT machine.id) = 1
), unassigned_balance AS (
  SELECT
    log.company_id,
    log.storage_location_id,
    log.material_id,
    log.batch_number,
    SUM(CASE WHEN log.direction = 'OUT' THEN -log.qty ELSE log.qty END) AS qty
  FROM erp_production.machine_stock_log AS log
  JOIN single_mts_machine AS single_machine
    ON single_machine.company_id = log.company_id
   AND single_machine.storage_location_id = log.storage_location_id
  WHERE log.machine_id IS NULL
  GROUP BY log.company_id, log.storage_location_id, log.material_id, log.batch_number
  HAVING SUM(CASE WHEN log.direction = 'OUT' THEN -log.qty ELSE log.qty END) > 0
), allocation AS (
  SELECT
    balance.*,
    single_machine.machine_id,
    gen_random_uuid() AS reference_document_id
  FROM unassigned_balance AS balance
  JOIN single_mts_machine AS single_machine
    ON single_machine.company_id = balance.company_id
   AND single_machine.storage_location_id = balance.storage_location_id
)
INSERT INTO erp_production.machine_stock_log (
  company_id,
  storage_location_id,
  material_id,
  machine_id,
  batch_number,
  qty,
  direction,
  source_type,
  reference_document_type,
  reference_document_id,
  created_by
)
SELECT
  company_id,
  storage_location_id,
  material_id,
  NULL,
  batch_number,
  qty,
  'OUT',
  'AUTO_SINGLE_MACHINE_ALLOT',
  'AUTO_SINGLE_MACHINE_ALLOT',
  reference_document_id,
  NULL::uuid
FROM allocation
UNION ALL
SELECT
  company_id,
  storage_location_id,
  material_id,
  machine_id,
  batch_number,
  qty,
  'IN',
  'AUTO_SINGLE_MACHINE_ALLOT',
  'AUTO_SINGLE_MACHINE_ALLOT',
  reference_document_id,
  NULL::uuid
FROM allocation;
