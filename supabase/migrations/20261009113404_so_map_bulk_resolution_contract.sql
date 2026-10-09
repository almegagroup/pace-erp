BEGIN;

-- §6 SO Map: an External FO Number identifies one dispatch inside one SO.
-- Re-uploading a confirmed changed quantity replaces that group's active
-- allocations atomically; it must not create a second active FO mapping.
-- Keep the lower-case RPC name unchanged, but quote it so the pinned
-- Supabase CLI does not mistake the `_atomic` suffix for `BEGIN ATOMIC`.
CREATE OR REPLACE FUNCTION erp_procurement."save_so_map_group_atomic"(p_group jsonb, p_allocations jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_production, public
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
  IF v_external_fo IS NOT NULL THEN
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

  -- Keep untouched items in a multi-SKU FO group. Only the SO line(s)
  -- supplied by this upload are replaced, so confirming SKU A's new quantity
  -- cannot silently release SKU B from the same FO.
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

REVOKE ALL ON FUNCTION erp_procurement."save_so_map_group_atomic"(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement."save_so_map_group_atomic"(jsonb, jsonb) TO service_role;

-- This migration runs before the original similarity-helper migration in the
-- current repository timestamp order. Define the helper here so the hardened
-- search-path contract is valid on a fresh database too.
CREATE OR REPLACE FUNCTION erp_master.find_similar_customer_names_in_vdc(
  p_name text,
  p_depot_code_id uuid,
  p_threshold real DEFAULT 0.35,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  customer_id text,
  customer_name text,
  customer_address_id text,
  site_name text,
  address_line text,
  town text,
  state text,
  similarity_score real
)
LANGUAGE sql
STABLE
SET search_path = erp_master, extensions, public
AS $function$
  SELECT cm.id::text, cm.customer_name, ca.id::text, ca.site_name, ca.address_line, ca.town, ca.state,
         extensions.similarity(cm.customer_name, p_name) AS similarity_score
  FROM erp_master.customer_master cm
  JOIN erp_master.customer_address ca
    ON ca.customer_id = cm.id
    AND ca.depot_code_id = p_depot_code_id
    AND ca.status = 'ACTIVE'
  WHERE p_depot_code_id IS NOT NULL
    AND extensions.similarity(cm.customer_name, p_name) >= p_threshold
  ORDER BY similarity_score DESC
  LIMIT p_limit;
$function$;
GRANT EXECUTE ON FUNCTION erp_master.find_similar_customer_names_in_vdc(text, uuid, real, integer) TO service_role;

-- The VDC-scoped similarity helper is invoked only by the server-side bulk
-- resolver. It already qualifies its objects, but an explicit search path
-- also prevents role-controlled path changes from altering its execution.
ALTER FUNCTION erp_master.find_similar_customer_names_in_vdc(text, uuid, real, integer)
  SET search_path = erp_master, extensions, public;
NOTIFY pgrst, 'reload schema';
COMMIT;
