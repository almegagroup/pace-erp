-- AC06 PO11-parity follow-up: the material identity convention locked for
-- PO11 (§35.18 -- Pace Code never shown, Material Name + External Code are
-- two separate columns) was never carried into AC06's own tables/report.
-- Live rows already resolve external_code from material_master via the
-- workspace handler; the CLOSED-month archive snapshot needs its own column
-- so History/Archive and the report keep showing External Code after close.

ALTER TABLE erp_production.ac06_month_archive_line
  ADD COLUMN IF NOT EXISTS material_external_code_snapshot text;

CREATE OR REPLACE FUNCTION erp_production.close_ac06_month(p_month_id uuid, p_closed_by uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = erp_production, public AS $$
DECLARE source_month erp_production.ac06_month%ROWTYPE; archive_id uuid;
BEGIN
  SELECT * INTO source_month FROM erp_production.ac06_month WHERE id = p_month_id FOR UPDATE;
  IF NOT FOUND OR source_month.status <> 'OPEN' THEN RAISE EXCEPTION 'AC06_MONTH_CLOSED'; END IF;
  INSERT INTO erp_production.ac06_month_archive(source_month_id, company_id, rate_month, archived_by) VALUES (source_month.id, source_month.company_id, source_month.rate_month, p_closed_by) RETURNING id INTO archive_id;
  INSERT INTO erp_production.ac06_month_archive_line(archive_id, material_id, material_code_snapshot, material_external_code_snapshot, material_name_snapshot, base_uom_code_snapshot, source_sloc_group_id_snapshot, source_sloc_group_name_snapshot, costing_group_id_snapshot, costing_group_name_snapshot, rate, verification_status, rate_changed_at, verified_at, verified_by, excluded_from_rate_input, display_order)
  SELECT archive_id, line.material_id, material.pace_code, material.external_code, material.material_name, material.base_uom_code, line.source_sloc_group_id, sloc.group_name, line.costing_group_id, line.costing_group_name_snapshot, line.rate, line.verification_status, line.rate_changed_at, line.verified_at, line.verified_by, line.excluded_from_rate_input, line.display_order FROM erp_production.ac06_month_line line LEFT JOIN erp_master.material_master material ON material.id = line.material_id JOIN erp_production.ac06_sloc_group sloc ON sloc.id = line.source_sloc_group_id WHERE line.month_id = source_month.id;
  INSERT INTO erp_production.ac06_month_archive_group_config(archive_id, source_sloc_group_id_snapshot, source_sloc_group_name_snapshot, costing_group_id_snapshot, costing_group_name_snapshot, material_id)
  SELECT archive_id, config.source_sloc_group_id, config.source_sloc_group_name_snapshot, config.costing_group_id, config.costing_group_name_snapshot, config.material_id FROM erp_production.ac06_month_group_config config WHERE config.month_id = source_month.id;
  UPDATE erp_production.ac06_month SET status = 'CLOSED', closed_at = now(), closed_by = p_closed_by, last_updated_at = now(), last_updated_by = p_closed_by WHERE id = source_month.id;
  RETURN archive_id;
END;
$$;

GRANT EXECUTE ON FUNCTION erp_production.close_ac06_month(uuid, uuid) TO service_role;
