-- AC06 PO11 parity: a material in a SLOC Group can be excluded from the
-- month's costing scope without losing its historical rate/mapping record.
-- This is intentionally a forward migration after the AC06 v3 workspace.

ALTER TABLE erp_production.ac06_month_line
  ADD COLUMN IF NOT EXISTS excluded_from_rate_input boolean NOT NULL DEFAULT false;

ALTER TABLE erp_production.ac06_month_archive_line
  ADD COLUMN IF NOT EXISTS excluded_from_rate_input boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ac06_month_line_inclusion_scope
  ON erp_production.ac06_month_line (month_id, source_sloc_group_id, excluded_from_rate_input);

COMMENT ON COLUMN erp_production.ac06_month_line.excluded_from_rate_input IS
  'PO11-parity monthly scope decision. Excluded material remains auditable but is unavailable for AC06 rate entry, verification, report, and dispatch resolution.';

CREATE OR REPLACE FUNCTION erp_production.resolve_ac06_dispatch_rate(p_company_id uuid, p_dispatch_month date, p_source_sloc_group_id uuid, p_material_id uuid)
RETURNS TABLE(usable boolean, rate numeric, reason_code text) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = erp_production, public AS $$
  SELECT CASE WHEN line.id IS NULL OR line.excluded_from_rate_input OR line.verification_status <> 'VERIFIED' OR line.rate <= 0 THEN false ELSE true END,
    COALESCE(line.rate, 0), CASE WHEN line.id IS NULL THEN 'AC06_RATE_MISSING' WHEN line.excluded_from_rate_input THEN 'AC06_RATE_EXCLUDED' WHEN line.verification_status <> 'VERIFIED' THEN 'AC06_RATE_PENDING_VERIFICATION' WHEN line.rate <= 0 THEN 'AC06_RATE_ZERO' ELSE NULL END
  FROM (SELECT 1) anchor
  LEFT JOIN erp_production.ac06_month month_row ON month_row.company_id = p_company_id AND month_row.rate_month = date_trunc('month', p_dispatch_month)::date
  LEFT JOIN erp_production.ac06_month_line line ON line.month_id = month_row.id AND line.company_id = p_company_id AND line.source_sloc_group_id = p_source_sloc_group_id AND line.material_id = p_material_id;
$$;

CREATE OR REPLACE FUNCTION erp_production.verify_ac06_rate_scopes(p_month_id uuid, p_line_ids uuid[], p_verified_by uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = erp_production, public AS $$
DECLARE invalid_count integer; updated_count integer;
BEGIN
  SELECT count(*) INTO invalid_count FROM unnest(p_line_ids) picked(id)
  LEFT JOIN erp_production.ac06_month_line line ON line.id = picked.id AND line.month_id = p_month_id
  WHERE line.id IS NULL OR line.excluded_from_rate_input OR line.verification_status <> 'PENDING' OR (line.costing_group_id IS NOT NULL AND line.id <> (SELECT leader.id FROM erp_production.ac06_month_line leader WHERE leader.month_id = line.month_id AND leader.source_sloc_group_id = line.source_sloc_group_id AND leader.costing_group_id = line.costing_group_id AND NOT leader.excluded_from_rate_input ORDER BY leader.display_order, leader.id LIMIT 1));
  IF invalid_count > 0 THEN RAISE EXCEPTION 'AC06_VERIFY_SELECTION_INVALID'; END IF;
  WITH selected AS (SELECT line.id, line.costing_group_id, line.source_sloc_group_id FROM erp_production.ac06_month_line line WHERE line.month_id = p_month_id AND line.id = ANY(p_line_ids) AND NOT line.excluded_from_rate_input), targets AS (
    SELECT id FROM selected WHERE costing_group_id IS NULL UNION SELECT line.id FROM erp_production.ac06_month_line line JOIN selected ON selected.costing_group_id = line.costing_group_id AND selected.source_sloc_group_id = line.source_sloc_group_id WHERE line.month_id = p_month_id AND selected.costing_group_id IS NOT NULL AND NOT line.excluded_from_rate_input)
  UPDATE erp_production.ac06_month_line line SET verification_status = 'VERIFIED', verified_at = now(), verified_by = p_verified_by, last_updated_at = now(), last_updated_by = p_verified_by WHERE line.id IN (SELECT id FROM targets);
  GET DIAGNOSTICS updated_count = ROW_COUNT; RETURN updated_count;
END;
$$;

CREATE OR REPLACE FUNCTION erp_production.close_ac06_month(p_month_id uuid, p_closed_by uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = erp_production, public AS $$
DECLARE source_month erp_production.ac06_month%ROWTYPE; archive_id uuid;
BEGIN
  SELECT * INTO source_month FROM erp_production.ac06_month WHERE id = p_month_id FOR UPDATE;
  IF NOT FOUND OR source_month.status <> 'OPEN' THEN RAISE EXCEPTION 'AC06_MONTH_CLOSED'; END IF;
  INSERT INTO erp_production.ac06_month_archive(source_month_id, company_id, rate_month, archived_by) VALUES (source_month.id, source_month.company_id, source_month.rate_month, p_closed_by) RETURNING id INTO archive_id;
  INSERT INTO erp_production.ac06_month_archive_line(archive_id, material_id, material_code_snapshot, material_name_snapshot, base_uom_code_snapshot, source_sloc_group_id_snapshot, source_sloc_group_name_snapshot, costing_group_id_snapshot, costing_group_name_snapshot, rate, verification_status, rate_changed_at, verified_at, verified_by, excluded_from_rate_input, display_order)
  SELECT archive_id, line.material_id, material.pace_code, material.material_name, material.base_uom_code, line.source_sloc_group_id, sloc.group_name, line.costing_group_id, line.costing_group_name_snapshot, line.rate, line.verification_status, line.rate_changed_at, line.verified_at, line.verified_by, line.excluded_from_rate_input, line.display_order FROM erp_production.ac06_month_line line LEFT JOIN erp_master.material_master material ON material.id = line.material_id JOIN erp_production.ac06_sloc_group sloc ON sloc.id = line.source_sloc_group_id WHERE line.month_id = source_month.id;
  INSERT INTO erp_production.ac06_month_archive_group_config(archive_id, source_sloc_group_id_snapshot, source_sloc_group_name_snapshot, costing_group_id_snapshot, costing_group_name_snapshot, material_id)
  SELECT archive_id, config.source_sloc_group_id, config.source_sloc_group_name_snapshot, config.costing_group_id, config.costing_group_name_snapshot, config.material_id FROM erp_production.ac06_month_group_config config WHERE config.month_id = source_month.id;
  UPDATE erp_production.ac06_month SET status = 'CLOSED', closed_at = now(), closed_by = p_closed_by, last_updated_at = now(), last_updated_by = p_closed_by WHERE id = source_month.id;
  RETURN archive_id;
END;
$$;

GRANT EXECUTE ON FUNCTION erp_production.resolve_ac06_dispatch_rate(uuid, date, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION erp_production.verify_ac06_rate_scopes(uuid, uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION erp_production.close_ac06_month(uuid, uuid) TO service_role;
