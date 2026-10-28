-- Restore the §138 machine-bucket reservation scope (lost in a regression).
--
-- 20261012130000 scoped PROCESS_PO reservations to the owning Process PO's
-- machine inside create_mts_documents_atomic's Page-4 bucket check.
-- 20261024072327 then recreated the whole function from the older
-- 20260921120000 text (to add the Prodshade batch identity) and silently put
-- the location-wide reservation query back.  Result in prod (2026-10-28,
-- CMP003): Page 4 preview shows the bucket as available (scoped rule), but
-- commit subtracts every open Process PO reservation at the location from a
-- small machine bucket and raises PROD_MTS_MACHINE_BUCKET_SHORT.
--
-- Same surgical clause replacement as 20261012130000, re-run against the
-- current definition so the 20261024 Prodshade batch-identity fix is kept.
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
  -- 20261024072327 was applied from a CRLF copy, so the stored body
  -- has \r\n; normalise before matching the LF clause below.
  v_function_definition := replace(v_function_definition, E'\r\n', E'\n');
  -- Idempotent: already scoped (e.g. applied earlier via MCP) -> nothing to do.
  IF position('reservation_process_order.machine_id IS NOT DISTINCT FROM v_need.machine_id' IN v_function_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old_clause IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'MTS machine-bucket reservation clause was not found; refusing an incomplete upgrade';
  END IF;
  EXECUTE replace(v_function_definition, v_old_clause, v_new_clause);
END;
$migration$;
