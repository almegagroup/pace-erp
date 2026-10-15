-- SO02 scheduled DD invoice-only cancellation.
--
-- Tally Invoice Date, not the system invoice timestamp, determines the
-- commercial quarter.  On the first ten calendar days of Jan/Apr/Jul/Oct the
-- Accounts team can review and cancel eligible records themselves.  From the
-- eleventh day, the daily cron job cancels any remaining records.
--
-- This migration deliberately composes cancel_vdc_invoice_only_atomic rather
-- than recreating invoice cancellation, DO cancellation or reservation release.
-- That established primitive is the only place which owns those cascades.
BEGIN;

DO $outer$
BEGIN
  EXECUTE $sql$
CREATE OR REPLACE FUNCTION erp_procurement.cancel_overdue_vdc_invoice_only_atomic(
  p_dc_id uuid,
  p_company_id uuid,
  p_cutoff_date date,
  p_reason text,
  p_actor uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, public
AS $fn$
DECLARE
  v_dc erp_procurement.delivery_challan%ROWTYPE;
  v_invoice_count integer;
  v_all_draft boolean;
  v_oldest_tally_date date;
  v_newest_tally_date date;
BEGIN
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'SCHEDULED_DD_CANCEL_REASON_REQUIRED';
  END IF;
  IF p_cutoff_date IS NULL THEN
    RAISE EXCEPTION 'SCHEDULED_DD_CANCEL_CUTOFF_REQUIRED';
  END IF;

  SELECT * INTO v_dc
  FROM erp_procurement.delivery_challan
  WHERE id = p_dc_id
    AND selling_company_id = p_company_id
    AND dc_type = 'SALES'
    AND pgi_deferred IS TRUE
    AND is_bulk_uploaded IS TRUE
    AND status = 'INVOICED'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCHEDULED_DD_CANCEL_DO_NOT_ELIGIBLE';
  END IF;

  -- Lock the exact invoice set before checking it and before delegating to the
  -- established atomic cancellation function.
  PERFORM 1
  FROM erp_procurement.sales_invoice
  WHERE dc_id = p_dc_id AND status <> 'CANCELLED'
  FOR UPDATE;

  SELECT
    count(*)::integer,
    bool_and(status = 'DRAFT'),
    min(tally_invoice_date),
    max(tally_invoice_date)
  INTO v_invoice_count, v_all_draft, v_oldest_tally_date, v_newest_tally_date
  FROM erp_procurement.sales_invoice
  WHERE dc_id = p_dc_id AND status <> 'CANCELLED';

  IF coalesce(v_invoice_count, 0) = 0
    OR v_all_draft IS DISTINCT FROM TRUE
    OR v_oldest_tally_date IS NULL
    OR v_newest_tally_date IS NULL
    OR v_newest_tally_date >= p_cutoff_date THEN
    RAISE EXCEPTION 'SCHEDULED_DD_CANCEL_INVOICE_NOT_OVERDUE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM erp_inventory.stock_document sd
    JOIN erp_procurement.sales_invoice si ON si.id = sd.reference_document_id
    WHERE si.dc_id = p_dc_id
      AND sd.reference_document_type = 'VDC_SALES_INVOICE'
  ) THEN
    RAISE EXCEPTION 'SCHEDULED_DD_CANCEL_STOCK_ALREADY_POSTED';
  END IF;

  PERFORM erp_procurement.cancel_vdc_invoice_only_atomic(p_dc_id, p_reason, p_actor);
END;
$fn$;

CREATE OR REPLACE FUNCTION erp_procurement.cancel_overdue_vdc_invoice_only_batch(
  p_company_id uuid,
  p_dc_ids uuid[],
  p_reason text,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, public
AS $fn$
DECLARE
  v_dc_id uuid;
  v_ids uuid[];
  v_cutoff_date date := date_trunc('quarter', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  v_cancelled integer := 0;
BEGIN
  SELECT array_agg(DISTINCT id) INTO v_ids
  FROM unnest(coalesce(p_dc_ids, ARRAY[]::uuid[])) AS id;
  IF coalesce(cardinality(v_ids), 0) = 0 THEN
    RAISE EXCEPTION 'SCHEDULED_DD_CANCEL_SELECTION_REQUIRED';
  END IF;
  IF cardinality(v_ids) > 100 THEN
    RAISE EXCEPTION 'SCHEDULED_DD_CANCEL_LIMIT';
  END IF;

  -- DEPENDENT: one shared transaction keeps the selected commercial batch
  -- all-or-nothing while each iteration reuses the existing DO/invoice/
  -- reservation cancellation primitive and its locks.
  FOREACH v_dc_id IN ARRAY v_ids LOOP
    PERFORM erp_procurement.cancel_overdue_vdc_invoice_only_atomic(
      v_dc_id, p_company_id, v_cutoff_date, p_reason, p_actor
    );
    v_cancelled := v_cancelled + 1;
  END LOOP;

  RETURN jsonb_build_object('cancelled_count', v_cancelled, 'cutoff_date', v_cutoff_date);
END;
$fn$;

CREATE OR REPLACE FUNCTION erp_procurement.run_scheduled_overdue_vdc_invoice_cancellation()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = erp_procurement, erp_inventory, public
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_cutoff_date date := date_trunc('quarter', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  v_candidate record;
  v_cancelled integer := 0;
  v_failed integer := 0;
  v_reason text;
BEGIN
  -- January/April/July/October, from the 11th onward.  A daily schedule means
  -- a transient job failure retries on the following night within that window.
  IF extract(month FROM v_today)::integer NOT IN (1, 4, 7, 10)
     OR v_today < v_cutoff_date + 10 THEN
    RETURN jsonb_build_object('cancelled_count', 0, 'failed_count', 0, 'cutoff_date', v_cutoff_date, 'ran', false);
  END IF;

  FOR v_candidate IN
    SELECT dc.id, dc.selling_company_id
    FROM erp_procurement.delivery_challan dc
    WHERE dc.dc_type = 'SALES'
      AND dc.pgi_deferred IS TRUE
      AND dc.is_bulk_uploaded IS TRUE
      AND dc.status = 'INVOICED'
      AND EXISTS (
        SELECT 1 FROM erp_procurement.sales_invoice si
        WHERE si.dc_id = dc.id
          AND si.status = 'DRAFT'
          AND si.tally_invoice_date < v_cutoff_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM erp_procurement.sales_invoice si
        WHERE si.dc_id = dc.id AND si.status NOT IN ('DRAFT', 'CANCELLED')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM erp_inventory.stock_document sd
        JOIN erp_procurement.sales_invoice si ON si.id = sd.reference_document_id
        WHERE si.dc_id = dc.id AND sd.reference_document_type = 'VDC_SALES_INVOICE'
      )
    ORDER BY dc.id
  LOOP
    v_reason := format(
      'System scheduled cancellation: DD invoice-only record remained without stock movement after quarter ending %s.',
      (v_cutoff_date - 1)::text
    );
    BEGIN
      PERFORM erp_procurement.cancel_overdue_vdc_invoice_only_atomic(
        v_candidate.id, v_candidate.selling_company_id, v_cutoff_date, v_reason, NULL
      );
      v_cancelled := v_cancelled + 1;
    EXCEPTION WHEN OTHERS THEN
      -- One stale/concurrently-completed candidate must not stop cancellation
      -- of the rest.  It remains eligible for the next daily retry.
      v_failed := v_failed + 1;
      RAISE WARNING 'scheduled DD invoice cancellation skipped a candidate: %', SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('cancelled_count', v_cancelled, 'failed_count', v_failed, 'cutoff_date', v_cutoff_date, 'ran', true);
END;
$fn$;
  $sql$;

  REVOKE ALL ON FUNCTION erp_procurement.cancel_overdue_vdc_invoice_only_atomic(uuid, uuid, date, text, uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION erp_procurement.cancel_overdue_vdc_invoice_only_batch(uuid, uuid[], text, uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION erp_procurement.run_scheduled_overdue_vdc_invoice_cancellation() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION erp_procurement.cancel_overdue_vdc_invoice_only_atomic(uuid, uuid, date, text, uuid) TO service_role;
  GRANT EXECUTE ON FUNCTION erp_procurement.cancel_overdue_vdc_invoice_only_batch(uuid, uuid[], text, uuid) TO service_role;
  GRANT EXECUTE ON FUNCTION erp_procurement.run_scheduled_overdue_vdc_invoice_cancellation() TO service_role;

  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'so02-auto-cancel-overdue-dd-invoices';
  PERFORM cron.schedule(
    'so02-auto-cancel-overdue-dd-invoices',
    '0 19 * * *', -- 00:30 Asia/Kolkata while cron.timezone is GMT
    'SELECT erp_procurement.run_scheduled_overdue_vdc_invoice_cancellation();'
  );
  PERFORM pg_notify('pgrst', 'reload schema');
END;
$outer$;

COMMIT;
