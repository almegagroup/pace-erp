/*
 * Gate: 27.26 AC06 v3
 * Purpose: PO11-parity company-scoped monthly costing-rate workspace for Dispatch.
 * Notes: AC06 v1/v2 tables had zero rows in Dev and Prod at the design lock. Retire them
 *        before creating the clean v3 workspace; no legacy AC06 behavior remains supported.
 */

BEGIN;

-- The v1/v2 tables were confirmed empty in both environments at the design lock.
-- Refuse to destroy any later-entered legacy data rather than silently dropping it.
DO $$
DECLARE
  legacy_rows bigint := 0;
BEGIN
  IF to_regclass('erp_production.sloc_group') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM erp_production.sloc_group' INTO legacy_rows;
  END IF;
  IF legacy_rows = 0 AND to_regclass('erp_production.sloc_group_member') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM erp_production.sloc_group_member' INTO legacy_rows;
  END IF;
  IF legacy_rows = 0 AND to_regclass('erp_production.costing_group') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM erp_production.costing_group' INTO legacy_rows;
  END IF;
  IF legacy_rows = 0 AND to_regclass('erp_production.costing_group_member') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM erp_production.costing_group_member' INTO legacy_rows;
  END IF;
  IF legacy_rows = 0 AND to_regclass('erp_production.costing_rate_line') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM erp_production.costing_rate_line' INTO legacy_rows;
  END IF;
  IF legacy_rows > 0 THEN
    RAISE EXCEPTION 'AC06 v1/v2 tables contain data; migration requires an explicit archival decision before retirement';
  END IF;
END $$;

DROP TABLE IF EXISTS erp_production.costing_rate_line CASCADE;
DROP TABLE IF EXISTS erp_production.costing_group_member CASCADE;
DROP TABLE IF EXISTS erp_production.costing_group CASCADE;
DROP TABLE IF EXISTS erp_production.sloc_group_member CASCADE;
DROP TABLE IF EXISTS erp_production.sloc_group CASCADE;

CREATE TABLE IF NOT EXISTS erp_production.ac06_sloc_group (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  group_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  UNIQUE (company_id, group_name)
);

CREATE TABLE IF NOT EXISTS erp_production.ac06_sloc_group_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  sloc_group_id uuid NOT NULL REFERENCES erp_production.ac06_sloc_group(id) ON DELETE CASCADE,
  storage_location_id uuid NOT NULL REFERENCES erp_inventory.storage_location_master(id),
  active boolean NOT NULL DEFAULT true,
  added_by uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_by uuid,
  removed_at timestamptz,
  UNIQUE (sloc_group_id, storage_location_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ac06_active_company_sloc_membership
  ON erp_production.ac06_sloc_group_member(company_id, storage_location_id)
  WHERE active;

CREATE TABLE IF NOT EXISTS erp_production.ac06_costing_group (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  sloc_group_id uuid NOT NULL REFERENCES erp_production.ac06_sloc_group(id) ON DELETE RESTRICT,
  group_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  UNIQUE (sloc_group_id, group_name)
);

CREATE TABLE IF NOT EXISTS erp_production.ac06_month (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  rate_month date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  carry_forward_from_month_id uuid REFERENCES erp_production.ac06_month(id),
  closed_at timestamptz,
  closed_by uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  UNIQUE (company_id, rate_month),
  CHECK (rate_month = date_trunc('month', rate_month)::date)
);

CREATE TABLE IF NOT EXISTS erp_production.ac06_month_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_id uuid NOT NULL REFERENCES erp_production.ac06_month(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  source_sloc_group_id uuid NOT NULL REFERENCES erp_production.ac06_sloc_group(id),
  material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  costing_group_id uuid REFERENCES erp_production.ac06_costing_group(id),
  costing_group_name_snapshot text,
  rate numeric NOT NULL DEFAULT 0 CHECK (rate >= 0),
  verification_status text NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED')),
  rate_changed_at timestamptz NOT NULL DEFAULT now(),
  rate_changed_by uuid NOT NULL,
  verified_at timestamptz,
  verified_by uuid,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  last_updated_at timestamptz,
  last_updated_by uuid,
  UNIQUE (month_id, source_sloc_group_id, material_id)
);

CREATE TABLE IF NOT EXISTS erp_production.ac06_month_group_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_id uuid NOT NULL REFERENCES erp_production.ac06_month(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  source_sloc_group_id uuid NOT NULL REFERENCES erp_production.ac06_sloc_group(id),
  costing_group_id uuid REFERENCES erp_production.ac06_costing_group(id),
  material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  source_sloc_group_name_snapshot text NOT NULL,
  costing_group_name_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  last_updated_at timestamptz,
  last_updated_by uuid,
  UNIQUE (month_id, source_sloc_group_id, material_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ac06_month_group_member
  ON erp_production.ac06_month_group_config(month_id, source_sloc_group_id, material_id)
  WHERE costing_group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS erp_production.ac06_month_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_month_id uuid NOT NULL REFERENCES erp_production.ac06_month(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  rate_month date NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid,
  UNIQUE (source_month_id)
);

CREATE TABLE IF NOT EXISTS erp_production.ac06_month_archive_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES erp_production.ac06_month_archive(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  material_code_snapshot text,
  material_name_snapshot text,
  base_uom_code_snapshot text,
  source_sloc_group_id_snapshot uuid,
  source_sloc_group_name_snapshot text NOT NULL,
  costing_group_id_snapshot uuid,
  costing_group_name_snapshot text,
  rate numeric NOT NULL DEFAULT 0,
  verification_status text NOT NULL CHECK (verification_status IN ('PENDING', 'VERIFIED')),
  rate_changed_at timestamptz,
  verified_at timestamptz,
  verified_by uuid,
  display_order integer NOT NULL DEFAULT 0,
  UNIQUE (archive_id, material_id, source_sloc_group_id_snapshot)
);

CREATE TABLE IF NOT EXISTS erp_production.ac06_month_archive_group_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES erp_production.ac06_month_archive(id) ON DELETE CASCADE,
  source_sloc_group_id_snapshot uuid,
  source_sloc_group_name_snapshot text NOT NULL,
  costing_group_id_snapshot uuid,
  costing_group_name_snapshot text,
  material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  UNIQUE (archive_id, source_sloc_group_id_snapshot, material_id)
);

CREATE INDEX IF NOT EXISTS idx_ac06_sloc_group_company ON erp_production.ac06_sloc_group(company_id, active, group_name);
CREATE INDEX IF NOT EXISTS idx_ac06_costing_group_parent ON erp_production.ac06_costing_group(sloc_group_id, active, group_name);
CREATE INDEX IF NOT EXISTS idx_ac06_month_company ON erp_production.ac06_month(company_id, rate_month DESC);
CREATE INDEX IF NOT EXISTS idx_ac06_month_line_scope ON erp_production.ac06_month_line(month_id, source_sloc_group_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_ac06_month_config_scope ON erp_production.ac06_month_group_config(month_id, source_sloc_group_id, costing_group_id);

CREATE OR REPLACE FUNCTION erp_production.resolve_ac06_dispatch_rate(
  p_company_id uuid,
  p_dispatch_month date,
  p_source_sloc_group_id uuid,
  p_material_id uuid
)
RETURNS TABLE(usable boolean, rate numeric, reason_code text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = erp_production, public
AS $$
  SELECT
    CASE
      WHEN line.id IS NULL THEN false
      WHEN line.verification_status <> 'VERIFIED' THEN false
      WHEN line.rate <= 0 THEN false
      ELSE true
    END AS usable,
    COALESCE(line.rate, 0) AS rate,
    CASE
      WHEN line.id IS NULL THEN 'AC06_RATE_MISSING'
      WHEN line.verification_status <> 'VERIFIED' THEN 'AC06_RATE_PENDING_VERIFICATION'
      WHEN line.rate <= 0 THEN 'AC06_RATE_ZERO'
      ELSE NULL
    END AS reason_code
  FROM (SELECT 1) anchor
  LEFT JOIN erp_production.ac06_month month_row
    ON month_row.company_id = p_company_id
   AND month_row.rate_month = date_trunc('month', p_dispatch_month)::date
  LEFT JOIN erp_production.ac06_month_line line
    ON line.month_id = month_row.id
   AND line.company_id = p_company_id
   AND line.source_sloc_group_id = p_source_sloc_group_id
   AND line.material_id = p_material_id;
$$;

GRANT EXECUTE ON FUNCTION erp_production.resolve_ac06_dispatch_rate(uuid, date, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION erp_production.verify_ac06_rate_scopes(
  p_month_id uuid,
  p_line_ids uuid[],
  p_verified_by uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, public
AS $$
DECLARE
  invalid_count integer;
  updated_count integer;
BEGIN
  SELECT count(*) INTO invalid_count
  FROM unnest(p_line_ids) AS picked(id)
  LEFT JOIN erp_production.ac06_month_line line ON line.id = picked.id AND line.month_id = p_month_id
  WHERE line.id IS NULL
     OR line.verification_status <> 'PENDING'
     OR (
       line.costing_group_id IS NOT NULL AND line.id <> (
         SELECT leader.id
         FROM erp_production.ac06_month_line leader
         WHERE leader.month_id = line.month_id
           AND leader.source_sloc_group_id = line.source_sloc_group_id
           AND leader.costing_group_id = line.costing_group_id
         ORDER BY leader.display_order, leader.id
         LIMIT 1
       )
     );
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'AC06_VERIFY_SELECTION_INVALID';
  END IF;

  WITH selected AS (
    SELECT line.id, line.costing_group_id, line.source_sloc_group_id
    FROM erp_production.ac06_month_line line
    WHERE line.month_id = p_month_id AND line.id = ANY(p_line_ids)
  ), targets AS (
    SELECT id FROM selected WHERE costing_group_id IS NULL
    UNION
    SELECT line.id
    FROM erp_production.ac06_month_line line
    JOIN selected ON selected.costing_group_id = line.costing_group_id
                 AND selected.source_sloc_group_id = line.source_sloc_group_id
    WHERE line.month_id = p_month_id AND selected.costing_group_id IS NOT NULL
  )
  UPDATE erp_production.ac06_month_line line
     SET verification_status = 'VERIFIED', verified_at = now(), verified_by = p_verified_by,
         last_updated_at = now(), last_updated_by = p_verified_by
   WHERE line.id IN (SELECT id FROM targets);
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

CREATE OR REPLACE FUNCTION erp_production.close_ac06_month(
  p_month_id uuid,
  p_closed_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, public
AS $$
DECLARE
  source_month erp_production.ac06_month%ROWTYPE;
  archive_id uuid;
BEGIN
  SELECT * INTO source_month FROM erp_production.ac06_month WHERE id = p_month_id FOR UPDATE;
  IF NOT FOUND OR source_month.status <> 'OPEN' THEN
    RAISE EXCEPTION 'AC06_MONTH_CLOSED';
  END IF;

  INSERT INTO erp_production.ac06_month_archive(source_month_id, company_id, rate_month, archived_by)
  VALUES (source_month.id, source_month.company_id, source_month.rate_month, p_closed_by)
  RETURNING id INTO archive_id;

  INSERT INTO erp_production.ac06_month_archive_line(
    archive_id, material_id, material_code_snapshot, material_name_snapshot, base_uom_code_snapshot,
    source_sloc_group_id_snapshot, source_sloc_group_name_snapshot, costing_group_id_snapshot,
    costing_group_name_snapshot, rate, verification_status, rate_changed_at, verified_at, verified_by, display_order
  )
  SELECT archive_id, line.material_id, material.pace_code, material.material_name, material.base_uom_code,
         line.source_sloc_group_id, sloc.group_name, line.costing_group_id, line.costing_group_name_snapshot,
         line.rate, line.verification_status, line.rate_changed_at, line.verified_at, line.verified_by, line.display_order
    FROM erp_production.ac06_month_line line
    LEFT JOIN erp_master.material_master material ON material.id = line.material_id
    JOIN erp_production.ac06_sloc_group sloc ON sloc.id = line.source_sloc_group_id
   WHERE line.month_id = source_month.id;

  INSERT INTO erp_production.ac06_month_archive_group_config(
    archive_id, source_sloc_group_id_snapshot, source_sloc_group_name_snapshot,
    costing_group_id_snapshot, costing_group_name_snapshot, material_id
  )
  SELECT archive_id, config.source_sloc_group_id, config.source_sloc_group_name_snapshot,
         config.costing_group_id, config.costing_group_name_snapshot, config.material_id
    FROM erp_production.ac06_month_group_config config
   WHERE config.month_id = source_month.id;

  UPDATE erp_production.ac06_month
     SET status = 'CLOSED', closed_at = now(), closed_by = p_closed_by,
         last_updated_at = now(), last_updated_by = p_closed_by
   WHERE id = source_month.id;
  RETURN archive_id;
END;
$$;

CREATE OR REPLACE FUNCTION erp_production.auto_close_expired_ac06_months(
  p_reference_date date DEFAULT current_date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_production, public
AS $$
DECLARE
  month_row record;
  closed_count integer := 0;
BEGIN
  FOR month_row IN
    SELECT id FROM erp_production.ac06_month
    WHERE status = 'OPEN' AND rate_month < date_trunc('month', p_reference_date)::date
    FOR UPDATE
  LOOP
    PERFORM erp_production.close_ac06_month(month_row.id, NULL);
    closed_count := closed_count + 1;
  END LOOP;
  RETURN closed_count;
END;
$$;

GRANT EXECUTE ON FUNCTION erp_production.verify_ac06_rate_scopes(uuid, uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION erp_production.close_ac06_month(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION erp_production.auto_close_expired_ac06_months(date) TO service_role;

COMMIT;
