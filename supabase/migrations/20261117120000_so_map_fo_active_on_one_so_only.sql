-- Found live 2026-11-17 (Bulk DO upload): the same Sales/Dispatch FO number
-- (sales_order_map_group.external_fo_number) was mapped ACTIVE on two different
-- SOs of the same customer PO (9000000489 and 9000000875). Bulk DO resolution
-- looks an FO up with .maybeSingle(), so two ACTIVE groups for one FO make it
-- fail with DO_BULK_SOURCE_REFERENCE_INVALID, and a real FO could also be
-- dispatched twice (once per SO).
--
-- The old save function only de-duplicated within ONE SO (so_id + FO), by
-- design ("no broad FO uniqueness rule"), so nothing stopped a second SO from
-- mapping an FO that was already live elsewhere.
--
-- New rule: an FO number may be ACTIVE on only one non-cancelled SO per company.
-- A group on another SO only counts while it still has at least one ACTIVE
-- allocation, so an old group whose allocations were all RELEASED (stale, but
-- still status=ACTIVE) never blocks a legitimate re-map. Existing duplicates are
-- left alone; this only stops NEW saves. Everything else is unchanged from the
-- live definition.
CREATE OR REPLACE FUNCTION erp_procurement.save_so_map_group_atomic(p_group jsonb, p_allocations jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'erp_procurement', 'erp_production', 'public'
AS $function$
    DECLARE
      v_group_id uuid;
      v_group_status text;
      v_external_fo text := nullif(p_group->>'external_fo_number', '');
    BEGIN
      IF jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array'
        OR jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'SO_MAP_GROUP_EMPTY';
      END IF;

      -- Do not use a broad FO uniqueness rule.  The lock key contains the
      -- actual SO and FO identity, so different SOs/destinations still run
      -- independently while matching uploads cannot race into two groups.
      PERFORM pg_advisory_xact_lock(hashtextextended(
        coalesce(p_group->>'so_id', '') || '|' || coalesce(v_external_fo, '') || '|' || coalesce(p_group->>'source', ''),
        0
      ));

      -- One live FO, one SO (per company). A second advisory lock keyed on the
      -- FO alone serialises two different SOs racing to claim the same FO.
      IF v_external_fo IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('so_map_fo|' || v_external_fo, 0));
        IF EXISTS (
          SELECT 1
          FROM erp_procurement.sales_order_map_group other_group
          JOIN erp_procurement.sales_order other_so ON other_so.id = other_group.so_id
          JOIN erp_procurement.sales_order this_so ON this_so.id = (p_group->>'so_id')::uuid
          WHERE other_group.status = 'ACTIVE'
            AND other_group.so_id <> this_so.id
            AND other_so.company_id = this_so.company_id
            AND other_so.status <> 'CANCELLED'
            AND (other_group.external_fo_number = v_external_fo
                 OR other_group.revised_external_fo_number = v_external_fo)
            AND EXISTS (
              SELECT 1 FROM erp_procurement.sales_order_map_allocation live_allocation
              WHERE live_allocation.map_group_id = other_group.id
                AND live_allocation.status = 'ACTIVE'
            )
        ) THEN
          RAISE EXCEPTION 'SO_MAP_FO_ACTIVE_ON_OTHER_SO';
        END IF;

        SELECT id, status INTO v_group_id, v_group_status
        FROM erp_procurement.sales_order_map_group
        WHERE so_id = (p_group->>'so_id')::uuid
          AND external_fo_number = v_external_fo
        FOR UPDATE;
      END IF;

      IF v_group_id IS NOT NULL THEN
        IF v_group_status = 'ACTIVE' AND EXISTS (
          SELECT 1
          FROM erp_procurement.delivery_challan_line line
          JOIN erp_procurement.sales_order_map_allocation allocation ON allocation.id = line.so_map_allocation_id
          JOIN erp_procurement.delivery_challan dc ON dc.id = line.dc_id
          WHERE allocation.map_group_id = v_group_id AND dc.status <> 'CANCELLED'
        ) THEN
          RAISE EXCEPTION 'SO_MAP_DO_LOCKED';
        END IF;
        UPDATE erp_procurement.sales_order_map_group
        SET customer_address_id = nullif(p_group->>'customer_address_id', '')::uuid,
            depot_code_id = nullif(p_group->>'depot_code_id', '')::uuid,
            status = 'ACTIVE',
            last_updated_by = (p_group->>'created_by')::uuid, last_updated_at = now()
        WHERE id = v_group_id;
      ELSE
        INSERT INTO erp_procurement.sales_order_map_group
          (so_id, fo_id, customer_address_id, depot_code_id, external_fo_number, status, created_by)
        VALUES
          ((p_group->>'so_id')::uuid, nullif(p_group->>'fo_id', '')::uuid,
           nullif(p_group->>'customer_address_id', '')::uuid, nullif(p_group->>'depot_code_id', '')::uuid,
           v_external_fo, 'ACTIVE', (p_group->>'created_by')::uuid)
        RETURNING id INTO v_group_id;
      END IF;

      UPDATE erp_procurement.sales_order_map_allocation existing
      SET allocated_qty = incoming.allocated_qty,
          customer_address_id = incoming.customer_address_id,
          depot_code_id = incoming.depot_code_id,
          sku_mismatch_confirmed = coalesce(incoming.sku_mismatch_confirmed, false),
          last_updated_by = incoming.created_by,
          last_updated_at = now()
      FROM jsonb_to_recordset(coalesce(p_allocations, '[]'::jsonb)) AS incoming(
        so_id uuid, so_line_id uuid, fo_id uuid, customer_address_id uuid, depot_code_id uuid,
        plan_feed_item_id uuid, allocated_qty numeric, sku_mismatch_confirmed boolean, created_by uuid
      )
      WHERE existing.map_group_id = v_group_id
        AND existing.so_line_id = incoming.so_line_id
        AND existing.status = 'ACTIVE';

      INSERT INTO erp_procurement.sales_order_map_allocation
        (so_id, so_line_id, fo_id, customer_address_id, depot_code_id, plan_feed_item_id,
         allocated_qty, status, sku_mismatch_confirmed, created_by, map_group_id)
      SELECT so_id, so_line_id, fo_id, customer_address_id, depot_code_id, plan_feed_item_id,
             allocated_qty, 'ACTIVE', coalesce(sku_mismatch_confirmed, false), created_by, v_group_id
      FROM jsonb_to_recordset(coalesce(p_allocations, '[]'::jsonb)) AS a(
        so_id uuid, so_line_id uuid, fo_id uuid, customer_address_id uuid, depot_code_id uuid,
        plan_feed_item_id uuid, allocated_qty numeric, sku_mismatch_confirmed boolean, created_by uuid
      )
      WHERE NOT EXISTS (
        SELECT 1 FROM erp_procurement.sales_order_map_allocation existing
        WHERE existing.map_group_id = v_group_id
          AND existing.so_line_id = a.so_line_id
          AND existing.status = 'ACTIVE'
      );
      RETURN v_group_id;
    END;
    $function$;

REVOKE ALL ON FUNCTION erp_procurement.save_so_map_group_atomic(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.save_so_map_group_atomic(jsonb, jsonb) TO service_role;
