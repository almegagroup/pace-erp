-- PO11 monthly auto-close integrity repair.
--
-- The original scheduled close intentionally recorded `archived_by = NULL`
-- for a system action, but the archive header column was declared NOT NULL.
-- That made every eligible plan fail before its archive was written.  The
-- function caught the error per plan, so pg_cron reported a successful query
-- returning zero rows while no month was actually closed.
--
-- NULL is the accurate audit value for a system-owned close.  A non-null UUID
-- continues to identify the user who manually closed a month.
BEGIN;

ALTER TABLE erp_procurement.procurement_monthly_plan_archive
  ALTER COLUMN archived_by DROP NOT NULL;

COMMENT ON COLUMN erp_procurement.procurement_monthly_plan_archive.archived_by IS
  'Manual close: the authenticated user UUID. Automatic month-end close: NULL (system action).';

-- pg_cron uses UTC for this project. 18:29 UTC is 23:59 IST. The job runs
-- every day but the function below permits work only on an actual month-end,
-- so this definition safely covers months with 28 through 31 days.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'po11-auto-close-expired-plans';

  IF v_job_id IS NULL THEN
    PERFORM cron.schedule(
      'po11-auto-close-expired-plans',
      '29 18 * * *',
      $cron_command$select erp_procurement.auto_close_expired_procurement_plans();$cron_command$
    );
  ELSE
    PERFORM cron.alter_job(v_job_id, schedule => '29 18 * * *');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION erp_procurement.auto_close_expired_procurement_plans()
RETURNS TABLE(closed_plan_id uuid, closed_company_id uuid, closed_plan_month date, archive_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, erp_master, public
AS $$
DECLARE
  v_plan record;
  v_archive_id uuid;
  v_days_in_month numeric;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
BEGIN
  -- Capture the state at the final minute of the month. Do not close an
  -- older, missed month with today's live stock; it needs an explicit
  -- historical reconstruction from the stock ledger instead.
  FOR v_plan IN
    SELECT id, company_id, plan_month
    FROM erp_procurement.procurement_monthly_plan
    WHERE status = 'OPEN'
      AND v_today = (date_trunc('month', v_today) + interval '1 month' - interval '1 day')::date
      AND plan_month = date_trunc('month', v_today)::date
    ORDER BY company_id
  LOOP
    v_days_in_month := extract(day FROM (
      date_trunc('month', v_plan.plan_month) + interval '1 month' - interval '1 day'
    ));

    INSERT INTO erp_procurement.procurement_monthly_plan_archive (
      source_plan_id, company_id, plan_month, archived_by
    )
    VALUES (v_plan.id, v_plan.company_id, v_plan.plan_month, NULL)
    RETURNING id INTO v_archive_id;

    INSERT INTO erp_procurement.procurement_monthly_plan_archive_line (
      archive_id, material_id, source_sloc_group_id_snapshot, planning_item_group_id_snapshot,
      material_code_snapshot, material_name_snapshot, material_external_code_snapshot, base_uom_code_snapshot,
      source_sloc_group_name_snapshot, planning_item_group_name_snapshot,
      excluded_from_dashboard, monthly_requirement_qty, safety_days, processing_time_days, lead_time_days,
      fixed_safety_stock_qty, fixed_replenishment_stock_qty,
      available_stock_qty, trn_stock_qty, ge_stock_qty, qa_stock_qty, total_stock_qty,
      derived_safety_stock_qty, derived_replenishment_stock_qty,
      effective_safety_stock_qty, effective_replenishment_stock_qty, display_order
    )
    SELECT
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
      coalesce(avail.qty, 0),
      coalesce(trn.qty, 0),
      coalesce(ge.qty, 0),
      coalesce(qa.qty, 0),
      coalesce(avail.qty, 0) + coalesce(trn.qty, 0) + coalesce(ge.qty, 0) + coalesce(qa.qty, 0),
      (case when v_days_in_month > 0 then pl.monthly_requirement_qty / v_days_in_month else 0 end) * pl.safety_days,
      (case when v_days_in_month > 0 then pl.monthly_requirement_qty / v_days_in_month else 0 end) * pl.safety_days
        + (case when v_days_in_month > 0 then pl.monthly_requirement_qty / v_days_in_month else 0 end)
          * (pl.processing_time_days + pl.lead_time_days),
      coalesce(
        pl.fixed_safety_stock_qty,
        (case when v_days_in_month > 0 then pl.monthly_requirement_qty / v_days_in_month else 0 end) * pl.safety_days
      ),
      coalesce(
        pl.fixed_replenishment_stock_qty,
        (case when v_days_in_month > 0 then pl.monthly_requirement_qty / v_days_in_month else 0 end) * pl.safety_days
          + (case when v_days_in_month > 0 then pl.monthly_requirement_qty / v_days_in_month else 0 end)
            * (pl.processing_time_days + pl.lead_time_days)
      ),
      pl.display_order
    FROM erp_procurement.procurement_monthly_plan_line pl
    JOIN erp_master.material_master m ON m.id = pl.material_id
    LEFT JOIN erp_procurement.planning_sloc_group sg ON sg.id = pl.source_sloc_group_id
    LEFT JOIN erp_procurement.planning_item_group ig ON ig.id = pl.planning_item_group_id
    LEFT JOIN LATERAL (
      SELECT sum(ss.quantity) AS qty
      FROM erp_inventory.stock_snapshot ss
      WHERE ss.company_id = v_plan.company_id
        AND ss.material_id = pl.material_id
        AND ss.stock_type_code = 'UNRESTRICTED'
        AND ss.storage_location_id IN (
          SELECT psgm.storage_location_id
          FROM erp_procurement.planning_sloc_group_member psgm
          WHERE psgm.sloc_group_id = pl.source_sloc_group_id
            AND psgm.active = true
        )
    ) avail ON true
    LEFT JOIN LATERAL (
      SELECT sum(ss.quantity) AS qty
      FROM erp_inventory.stock_snapshot ss
      WHERE ss.company_id = v_plan.company_id
        AND ss.material_id = pl.material_id
        AND ss.stock_type_code = 'QUALITY_INSPECTION'
        AND ss.storage_location_id IN (
          SELECT psgm.storage_location_id
          FROM erp_procurement.planning_sloc_group_member psgm
          WHERE psgm.sloc_group_id = pl.source_sloc_group_id
            AND psgm.active = true
        )
    ) qa ON true
    LEFT JOIN LATERAL (
      SELECT sum(cn.dispatch_qty) AS qty
      FROM erp_procurement.consignment_note cn
      JOIN erp_procurement.purchase_order po ON po.id = cn.po_id
      WHERE cn.status = 'TRN'
        AND po.company_id = v_plan.company_id
        AND cn.material_id = pl.material_id
    ) trn ON true
    LEFT JOIN LATERAL (
      SELECT sum(gel.ge_qty) AS qty
      FROM erp_procurement.gate_entry_line gel
      JOIN erp_procurement.gate_entry ge ON ge.id = gel.gate_entry_id
      WHERE ge.company_id = v_plan.company_id
        AND ge.status = 'OPEN'
        AND gel.grn_posted = false
        AND gel.material_id = pl.material_id
    ) ge ON true
    WHERE pl.plan_id = v_plan.id;

    INSERT INTO erp_procurement.procurement_monthly_plan_archive_group_config (
      archive_id, planning_item_group_id, planning_item_group_name_snapshot,
      monthly_requirement_qty, safety_days, processing_time_days, lead_time_days,
      fixed_safety_stock_qty, fixed_replenishment_stock_qty
    )
    SELECT
      v_archive_id,
      gc.planning_item_group_id,
      ig.group_name,
      gc.monthly_requirement_qty,
      gc.safety_days,
      gc.processing_time_days,
      gc.lead_time_days,
      gc.fixed_safety_stock_qty,
      gc.fixed_replenishment_stock_qty
    FROM erp_procurement.procurement_monthly_plan_group_config gc
    JOIN erp_procurement.planning_item_group ig ON ig.id = gc.planning_item_group_id
    WHERE gc.plan_id = v_plan.id;

    UPDATE erp_procurement.procurement_monthly_plan
    SET status = 'CLOSED',
        closed_at = now(),
        closed_by = NULL,
        last_updated_at = now()
    WHERE id = v_plan.id;

    closed_plan_id := v_plan.id;
    closed_company_id := v_plan.company_id;
    closed_plan_month := v_plan.plan_month;
    archive_id := v_archive_id;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;

COMMENT ON FUNCTION erp_procurement.auto_close_expired_procurement_plans() IS
  'PO11 system month-end close. At 23:59 IST on the final calendar day, it closes that month and archives the then-current planning stock. Older missed months are intentionally left open for ledger-based historical recovery.';

COMMIT;
