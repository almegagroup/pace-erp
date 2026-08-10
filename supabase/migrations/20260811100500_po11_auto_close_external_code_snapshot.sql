-- Keep the automatic month-end close (20260810190000_po11_auto_close_expired_plans.sql)
-- in sync with the manual close path now that material_external_code_snapshot
-- exists (20260811100000) -- per that migration's own header comment: "If the
-- planning formula in loadWorkspaceRows ever changes, this function must be
-- updated to match, or the automatic close will silently diverge."

create or replace function erp_procurement.auto_close_expired_procurement_plans()
returns table(closed_plan_id uuid, closed_company_id uuid, closed_plan_month date, archive_id uuid)
language plpgsql
security definer
set search_path = erp_procurement, erp_inventory, erp_master, public
as $$
declare
  v_plan record;
  v_archive_id uuid;
  v_days_in_month numeric;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  for v_plan in
    select id, company_id, plan_month
    from erp_procurement.procurement_monthly_plan
    where status = 'OPEN'
      and (plan_month + interval '1 month')::date <= v_today
    order by plan_month, company_id
  loop
    begin
      v_days_in_month := extract(day from (date_trunc('month', v_plan.plan_month) + interval '1 month' - interval '1 day'));

      insert into erp_procurement.procurement_monthly_plan_archive (source_plan_id, company_id, plan_month, archived_by)
      values (v_plan.id, v_plan.company_id, v_plan.plan_month, null)
      returning id into v_archive_id;

      insert into erp_procurement.procurement_monthly_plan_archive_line (
        archive_id, material_id, source_sloc_group_id_snapshot, planning_item_group_id_snapshot,
        material_code_snapshot, material_name_snapshot, material_external_code_snapshot, base_uom_code_snapshot,
        source_sloc_group_name_snapshot, planning_item_group_name_snapshot,
        excluded_from_dashboard, monthly_requirement_qty, safety_days, processing_time_days, lead_time_days,
        fixed_safety_stock_qty, fixed_replenishment_stock_qty,
        available_stock_qty, trn_stock_qty, ge_stock_qty, qa_stock_qty, total_stock_qty,
        derived_safety_stock_qty, derived_replenishment_stock_qty,
        effective_safety_stock_qty, effective_replenishment_stock_qty, display_order
      )
      select
        v_archive_id,
        pl.material_id,
        pl.source_sloc_group_id,
        pl.planning_item_group_id,
        m.pace_code,
        m.material_name,
        m.external_code,
        m.base_uom_code,
        sg.group_name,
        ig.group_name,
        pl.excluded_from_dashboard,
        pl.monthly_requirement_qty,
        pl.safety_days,
        pl.processing_time_days,
        pl.lead_time_days,
        pl.fixed_safety_stock_qty,
        pl.fixed_replenishment_stock_qty,
        coalesce(avail.qty, 0) as available_stock_qty,
        coalesce(trn.qty, 0) as trn_stock_qty,
        coalesce(ge.qty, 0) as ge_stock_qty,
        coalesce(qa.qty, 0) as qa_stock_qty,
        coalesce(avail.qty, 0) + coalesce(trn.qty, 0) + coalesce(ge.qty, 0) + coalesce(qa.qty, 0) as total_stock_qty,
        (case when v_days_in_month > 0 then pl.monthly_requirement_qty / v_days_in_month else 0 end) * pl.safety_days as derived_safety_stock_qty,
        (case when v_days_in_month > 0 then pl.monthly_requirement_qty / v_days_in_month else 0 end) * pl.safety_days
          + (case when v_days_in_month > 0 then pl.monthly_requirement_qty / v_days_in_month else 0 end) * (pl.processing_time_days + pl.lead_time_days)
          as derived_replenishment_stock_qty,
        coalesce(pl.fixed_safety_stock_qty,
          (case when v_days_in_month > 0 then pl.monthly_requirement_qty / v_days_in_month else 0 end) * pl.safety_days
        ) as effective_safety_stock_qty,
        coalesce(pl.fixed_replenishment_stock_qty,
          (case when v_days_in_month > 0 then pl.monthly_requirement_qty / v_days_in_month else 0 end) * pl.safety_days
            + (case when v_days_in_month > 0 then pl.monthly_requirement_qty / v_days_in_month else 0 end) * (pl.processing_time_days + pl.lead_time_days)
        ) as effective_replenishment_stock_qty,
        pl.display_order
      from erp_procurement.procurement_monthly_plan_line pl
      join erp_master.material_master m on m.id = pl.material_id
      left join erp_procurement.planning_sloc_group sg on sg.id = pl.source_sloc_group_id
      left join erp_procurement.planning_item_group ig on ig.id = pl.planning_item_group_id
      left join lateral (
        select sum(ss.quantity) as qty
        from erp_inventory.stock_snapshot ss
        where ss.company_id = v_plan.company_id
          and ss.material_id = pl.material_id
          and ss.stock_type_code = 'UNRESTRICTED'
          and ss.storage_location_id in (
            select psgm2.storage_location_id from erp_procurement.planning_sloc_group_member psgm2
            where psgm2.sloc_group_id = pl.source_sloc_group_id and psgm2.active = true
          )
      ) avail on true
      left join lateral (
        select sum(ss.quantity) as qty
        from erp_inventory.stock_snapshot ss
        where ss.company_id = v_plan.company_id
          and ss.material_id = pl.material_id
          and ss.stock_type_code = 'QUALITY_INSPECTION'
          and ss.storage_location_id in (
            select psgm3.storage_location_id from erp_procurement.planning_sloc_group_member psgm3
            where psgm3.sloc_group_id = pl.source_sloc_group_id and psgm3.active = true
          )
      ) qa on true
      left join lateral (
        select sum(cn.dispatch_qty) as qty
        from erp_procurement.consignment_note cn
        join erp_procurement.purchase_order po on po.id = cn.po_id
        where cn.status = 'TRN'
          and po.company_id = v_plan.company_id
          and cn.material_id = pl.material_id
      ) trn on true
      left join lateral (
        select sum(gel.ge_qty) as qty
        from erp_procurement.gate_entry_line gel
        join erp_procurement.gate_entry ge on ge.id = gel.gate_entry_id
        where ge.company_id = v_plan.company_id
          and ge.status = 'OPEN'
          and gel.grn_posted = false
          and gel.material_id = pl.material_id
      ) ge on true
      where pl.plan_id = v_plan.id;

      insert into erp_procurement.procurement_monthly_plan_archive_group_config (
        archive_id, planning_item_group_id, planning_item_group_name_snapshot,
        monthly_requirement_qty, safety_days, processing_time_days, lead_time_days,
        fixed_safety_stock_qty, fixed_replenishment_stock_qty
      )
      select
        v_archive_id,
        gc.planning_item_group_id,
        ig.group_name,
        gc.monthly_requirement_qty,
        gc.safety_days,
        gc.processing_time_days,
        gc.lead_time_days,
        gc.fixed_safety_stock_qty,
        gc.fixed_replenishment_stock_qty
      from erp_procurement.procurement_monthly_plan_group_config gc
      join erp_procurement.planning_item_group ig on ig.id = gc.planning_item_group_id
      where gc.plan_id = v_plan.id;

      update erp_procurement.procurement_monthly_plan
      set status = 'CLOSED',
          closed_at = now(),
          closed_by = null,
          last_updated_at = now()
      where id = v_plan.id;

      closed_plan_id := v_plan.id;
      closed_company_id := v_plan.company_id;
      closed_plan_month := v_plan.plan_month;
      archive_id := v_archive_id;
      return next;
    exception when others then
      raise warning 'PO11_AUTO_CLOSE_FAILED company_id=%, plan_id=%, plan_month=%, error=%',
        v_plan.company_id, v_plan.id, v_plan.plan_month, sqlerrm;
    end;
  end loop;
  return;
end;
$$;

comment on function erp_procurement.auto_close_expired_procurement_plans() is
  'PO11 automatic month-end close (feasibility Section 35.13). Scheduled daily via pg_cron at 00:05 IST; closes any OPEN monthly plan whose plan_month has fully ended (IST calendar), archiving the same fields the manual Close Month action would (now including material_external_code_snapshot, 2026-08-11). Safe to run more than once a day -- only picks up status=''OPEN'' rows.';
