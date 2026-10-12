-- §138 machine-bucket availability correction (2026-10-12).
--
-- `create_mts_documents_atomic` correctly totals physical stock from the
-- selected machine bucket, but its old Page-4 reservation query deducted all
-- open reservations for the storage location.  Consequently an open Process
-- PO on Machine B could make Machine A appear short (or negative).  The UI
-- already scopes PROCESS_PO reservations to the owning Process PO machine;
-- this migration makes the atomic transaction use that same rule.  Non
-- PROCESS_PO reservations remain location-wide, exactly as before.
--
-- Keep this deliberately surgical: the current function is the final
-- definition supplied by 20260921120000.  Replacing only the bucket-reserve
-- clause preserves the rest of its transactional creation behaviour.
DO $migration$
DECLARE
  v_function_definition text;
  v_old_clause text := $old$
        AND machine_id IS NOT DISTINCT FROM v_need.machine_id;
    SELECT COALESCE(SUM(balance_qty), 0) INTO v_reserved
      FROM erp_production.reservation_document
      WHERE company_id = v_company_id AND material_id = v_need.material_id
        AND storage_location_id = v_need.storage_location_id
        AND status IN ('OPEN', 'PARTIAL');$old$;
  v_new_clause text := $new$
        AND machine_id IS NOT DISTINCT FROM v_need.machine_id;
    -- A PROCESS_PO reservation belongs to the physical bucket of that
    -- Process PO's machine.  Other reservation sources remain location-wide.
    -- This mirrors fetchNetMachineBucketBalances() used by Page 4 preview.
    SELECT COALESCE(SUM(reservation.balance_qty), 0) INTO v_reserved
      FROM erp_production.reservation_document AS reservation
      LEFT JOIN erp_production.process_order AS reservation_process_order
        ON reservation.source_type = 'PROCESS_PO'
       AND reservation_process_order.id = reservation.source_id
      WHERE reservation.company_id = v_company_id
        AND reservation.material_id = v_need.material_id
        AND reservation.storage_location_id = v_need.storage_location_id
        AND reservation.status IN ('OPEN', 'PARTIAL')
        AND (
          reservation.source_type <> 'PROCESS_PO'
          OR (
            reservation_process_order.id IS NOT NULL
            AND reservation_process_order.machine_id IS NOT DISTINCT FROM v_need.machine_id
          )
        );$new$;
BEGIN
  SELECT pg_get_functiondef('erp_production.create_mts_documents_atomic(jsonb)'::regprocedure)
    INTO v_function_definition;
  IF position(v_old_clause IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'MTS machine-bucket reservation clause was not found; refusing an incomplete upgrade';
  END IF;
  EXECUTE replace(v_function_definition, v_old_clause, v_new_clause);
END;
$migration$;
