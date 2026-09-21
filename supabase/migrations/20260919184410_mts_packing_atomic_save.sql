-- Page 6 creates several Packing POs from one confirmed MTS plan.  This
-- function deliberately owns all related writes so PostgreSQL rolls back the
-- whole request if any header, line, reservation, or staging-row update fails.
create or replace function erp_production.create_mts_packing_orders_atomic(
  p_orders jsonb
)
returns table(packing_order_id uuid, po_number text)
language plpgsql
security invoker
set search_path = erp_production, public
as $$
declare
  v_item jsonb;
  v_order jsonb;
  v_line jsonb;
  v_packing_order_id uuid;
  v_line_id uuid;
begin
  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'At least one Packing PO is required';
  end if;

  for v_item in select value from jsonb_array_elements(p_orders)
  loop
    v_order := v_item->'order';
    perform pg_advisory_xact_lock(hashtext(coalesce(v_order->>'process_order_id', '')));

    insert into erp_production.packing_order (
      company_id, po_number, po_type, source_po_type, process_order_id, machine_id,
      material_id, pack_code_id, batch_number_from, batch_number_to, fill_qty_per_pack,
      num_packs, sku_qty, fg_conversion_qty, sfg_conversion_qty, planned_qty_kg,
      total_qty_kg, status, segment_code, created_by, created_at, last_updated_at,
      last_updated_by
    ) values (
      (v_order->>'company_id')::uuid, v_order->>'po_number', v_order->>'po_type',
      v_order->>'source_po_type', (v_order->>'process_order_id')::uuid, null,
      (v_order->>'material_id')::uuid, (v_order->>'pack_code_id')::uuid,
      nullif(v_order->>'batch_number_from', ''), nullif(v_order->>'batch_number_to', ''),
      (v_order->>'fill_qty_per_pack')::numeric, (v_order->>'num_packs')::numeric,
      (v_order->>'sku_qty')::numeric, (v_order->>'fg_conversion_qty')::numeric,
      (v_order->>'sfg_conversion_qty')::numeric, (v_order->>'planned_qty_kg')::numeric,
      (v_order->>'total_qty_kg')::numeric, v_order->>'status', v_order->>'segment_code',
      (v_order->>'actor_id')::uuid, (v_order->>'now')::timestamptz,
      (v_order->>'now')::timestamptz, (v_order->>'actor_id')::uuid
    ) returning id into v_packing_order_id;

    for v_line in select value from jsonb_array_elements(v_item->'lines')
    loop
      insert into erp_production.packing_order_line (
        packing_order_id, line_type, material_id, actual_material_id, batch_number,
        qty_per_pack, total_qty, actual_qty, issue_sloc_id, uom_code,
        movement_type_code, has_alternate, material_group_id, display_order
      ) values (
        v_packing_order_id, v_line->>'line_type', (v_line->>'material_id')::uuid,
        nullif(v_line->>'actual_material_id', '')::uuid, null,
        (v_line->>'qty_per_pack')::numeric, (v_line->>'total_qty')::numeric, null,
        nullif(v_line->>'issue_sloc_id', '')::uuid, v_line->>'uom_code',
        v_line->>'movement_type_code', coalesce((v_line->>'has_alternate')::boolean, false),
        nullif(v_line->>'material_group_id', '')::uuid, (v_line->>'display_order')::integer
      ) returning id into v_line_id;

      if v_line->>'line_type' <> 'FG' then
        insert into erp_production.reservation_document (
          source_type, source_id, source_line_id, company_id, material_id,
          storage_location_id, required_qty, uom_code, issued_qty, status,
          batch_number, created_by, created_at, last_updated_by, last_updated_at
        ) values (
          'PACKING_PO', v_packing_order_id, v_line_id, (v_order->>'company_id')::uuid,
          coalesce(nullif(v_line->>'actual_material_id', '')::uuid, (v_line->>'material_id')::uuid),
          nullif(v_line->>'issue_sloc_id', '')::uuid, (v_line->>'total_qty')::numeric,
          v_line->>'uom_code', 0, 'OPEN', null, (v_order->>'actor_id')::uuid,
          (v_order->>'now')::timestamptz, (v_order->>'actor_id')::uuid,
          (v_order->>'now')::timestamptz
        );
      end if;
    end loop;

    update erp_production.mts_packing_plan_row
      set status = 'CONVERTED', packing_order_id = v_packing_order_id,
          last_updated_by = (v_order->>'actor_id')::uuid,
          last_updated_at = (v_order->>'now')::timestamptz
      where id = (v_item->>'plan_row_id')::uuid and status = 'PLANNED';
    if not found then
      raise exception 'Packing plan row % is no longer available', v_item->>'plan_row_id';
    end if;

    packing_order_id := v_packing_order_id;
    po_number := v_order->>'po_number';
    return next;
  end loop;
end;
$$;

revoke all on function erp_production.create_mts_packing_orders_atomic(jsonb) from public;
grant execute on function erp_production.create_mts_packing_orders_atomic(jsonb) to service_role;
