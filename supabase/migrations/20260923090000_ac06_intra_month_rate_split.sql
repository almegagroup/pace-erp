/*
 * Gate: 27.26 AC06 v3.1
 * Purpose: intra-month rate-change split rows (business owner design,
 *          feasibility doc Section 139) -- a material's AC06 rate can now
 *          change mid-month, taking effect from a chosen date, without
 *          waiting for the next month. A split row shares the same
 *          (month, source_sloc_group, material) as its parent, distinguished
 *          only by effective_date. Existing rows all become the material's
 *          "primary" row, effective_date = that month's start (unchanged
 *          resolution result for every month that never uses a split).
 */

BEGIN;

-- 1) ac06_month_line: effective_date + parent_line_id ------------------------
ALTER TABLE erp_production.ac06_month_line
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS parent_line_id uuid REFERENCES erp_production.ac06_month_line(id) ON DELETE CASCADE;

UPDATE erp_production.ac06_month_line l
SET effective_date = m.rate_month
FROM erp_production.ac06_month m
WHERE l.month_id = m.id AND l.effective_date IS NULL;

ALTER TABLE erp_production.ac06_month_line ALTER COLUMN effective_date SET NOT NULL;

-- A freshly-inserted split row starts as a blank draft (rate/wastage filled
-- in afterwards) -- loosen NOT NULL so the insert can omit them. Every
-- non-split row still always carries a real value (ensureScopeRows / the
-- carry-forward path in getMonth() both always set one).
ALTER TABLE erp_production.ac06_month_line ALTER COLUMN rate DROP NOT NULL;
ALTER TABLE erp_production.ac06_month_line ALTER COLUMN wastage_other_pct DROP NOT NULL;

-- Unnamed inline `CHECK (rate >= 0)` on the original CREATE TABLE gets
-- Postgres's deterministic auto-name for a single-column check, so this is
-- safe to target directly rather than introspect for.
ALTER TABLE erp_production.ac06_month_line DROP CONSTRAINT IF EXISTS ac06_month_line_rate_check;
ALTER TABLE erp_production.ac06_month_line
  ADD CONSTRAINT ac06_month_line_rate_check CHECK (rate IS NULL OR rate >= 0);

-- Widen (month, sloc group, material) uniqueness to include effective_date --
-- a split row shares all three with its parent, distinguished only by date.
DO $$
DECLARE found_name text;
BEGIN
  SELECT con.conname INTO found_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'erp_production' AND rel.relname = 'ac06_month_line' AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) = 'UNIQUE (month_id, source_sloc_group_id, material_id)';
  IF found_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE erp_production.ac06_month_line DROP CONSTRAINT %I', found_name);
  END IF;
END $$;
ALTER TABLE erp_production.ac06_month_line
  ADD CONSTRAINT ac06_month_line_month_group_material_date_key
  UNIQUE (month_id, source_sloc_group_id, material_id, effective_date);

CREATE INDEX IF NOT EXISTS idx_ac06_month_line_parent ON erp_production.ac06_month_line(parent_line_id) WHERE parent_line_id IS NOT NULL;

-- 2) ac06_month_archive_line: matching effective_date -------------------------
-- (no parent_line_id_snapshot -- date-based resolution never needs the parent
-- chain, only (material_id, effective_date, rate) per row.)
ALTER TABLE erp_production.ac06_month_archive_line
  ADD COLUMN IF NOT EXISTS effective_date date;

UPDATE erp_production.ac06_month_archive_line l
SET effective_date = a.rate_month
FROM erp_production.ac06_month_archive a
WHERE l.archive_id = a.id AND l.effective_date IS NULL;

ALTER TABLE erp_production.ac06_month_archive_line ALTER COLUMN effective_date SET NOT NULL;

DO $$
DECLARE found_name text;
BEGIN
  SELECT con.conname INTO found_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'erp_production' AND rel.relname = 'ac06_month_archive_line' AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) = 'UNIQUE (archive_id, material_id, source_sloc_group_id_snapshot)';
  IF found_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE erp_production.ac06_month_archive_line DROP CONSTRAINT %I', found_name);
  END IF;
END $$;
ALTER TABLE erp_production.ac06_month_archive_line
  ADD CONSTRAINT ac06_month_archive_line_archive_material_sloc_date_key
  UNIQUE (archive_id, material_id, source_sloc_group_id_snapshot, effective_date);

-- 3) close_ac06_month(): carry effective_date into the archive, AND fix a
--    real pre-existing gap found while rewriting this function -- the
--    2026-09-05 wastage_other_pct migration added the archive column and
--    said in its own comment "captured on the immutable per-month archive",
--    but never actually updated this INSERT to populate it, so every closed
--    month has archived wastage_other_pct=0 (the column default) regardless
--    of the live value at close time. Fixed here alongside effective_date
--    since resolveAc06RatesAsOf() (ac06_workspace.handlers.ts) now reads
--    wastage_other_pct from archived rows too. (material_external_code_snapshot,
--    added 2026-08-24, is also preserved -- this replaces that migration's
--    version of the function, not the original v3 one.)
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
    archive_id, material_id, material_code_snapshot, material_external_code_snapshot, material_name_snapshot,
    base_uom_code_snapshot, source_sloc_group_id_snapshot, source_sloc_group_name_snapshot, costing_group_id_snapshot,
    costing_group_name_snapshot, rate, wastage_other_pct, verification_status, rate_changed_at, verified_at, verified_by,
    excluded_from_rate_input, display_order, effective_date
  )
  SELECT archive_id, line.material_id, material.pace_code, material.external_code, material.material_name,
         material.base_uom_code, line.source_sloc_group_id, sloc.group_name, line.costing_group_id, line.costing_group_name_snapshot,
         line.rate, line.wastage_other_pct, line.verification_status, line.rate_changed_at, line.verified_at, line.verified_by,
         line.excluded_from_rate_input, line.display_order, line.effective_date
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

-- 4) verify_ac06_rate_scopes(): a split row auto-verifies on save (see
--    saveAc06RatesHandler) and must never be selectable via the manual bulk
--    Verify action -- defense in depth alongside the frontend never listing
--    one. This replaces the 2026-08-24 excluded_from_rate_input-aware
--    version (20260824160000), not the original v3 one -- that check is
--    preserved below, not dropped.
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
     OR line.excluded_from_rate_input
     OR line.parent_line_id IS NOT NULL
     OR line.verification_status <> 'PENDING'
     OR (
       line.costing_group_id IS NOT NULL AND line.id <> (
         SELECT leader.id
         FROM erp_production.ac06_month_line leader
         WHERE leader.month_id = line.month_id
           AND leader.source_sloc_group_id = line.source_sloc_group_id
           AND leader.costing_group_id = line.costing_group_id
           AND leader.parent_line_id IS NULL
           AND NOT leader.excluded_from_rate_input
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
    WHERE line.month_id = p_month_id AND line.id = ANY(p_line_ids) AND NOT line.excluded_from_rate_input
  ), targets AS (
    SELECT id FROM selected WHERE costing_group_id IS NULL
    UNION
    SELECT line.id
    FROM erp_production.ac06_month_line line
    JOIN selected ON selected.costing_group_id = line.costing_group_id
                 AND selected.source_sloc_group_id = line.source_sloc_group_id
    WHERE line.month_id = p_month_id AND selected.costing_group_id IS NOT NULL
      AND line.parent_line_id IS NULL AND NOT line.excluded_from_rate_input
  )
  UPDATE erp_production.ac06_month_line line
     SET verification_status = 'VERIFIED', verified_at = now(), verified_by = p_verified_by,
         last_updated_at = now(), last_updated_by = p_verified_by
   WHERE line.id IN (SELECT id FROM targets);
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION erp_production.close_ac06_month(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION erp_production.verify_ac06_rate_scopes(uuid, uuid[], uuid) TO service_role;

COMMIT;
