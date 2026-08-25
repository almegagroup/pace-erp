/*
 * Purpose: Stock History (§130.2 correction, 2026-08-25) -- the Opening Stock
 *          movement family (P561-566) must ALWAYS fold into the Opening
 *          figure and never appear as an in-range bucket entry (e.g.
 *          "Inward"), regardless of where its own posting_date falls
 *          relative to the report's selected date range. An Opening Stock
 *          entry represents starting balance, never an in-period movement,
 *          no matter when it was actually keyed in. Business-owner-confirmed
 *          worked example: From=1st Aug with a P561 dated 1st Aug must show
 *          that P561's full quantity as Opening, not as Inward -- the
 *          previous version only got this right when the P561 predated the
 *          report's From-date, not when it fell exactly on it (or, by the
 *          same logic, anywhere inside the visible range at all).
 *
 *          `after_range_real` (used only to correctly back Closing out to
 *          the report's own to_date) is deliberately left untouched -- it
 *          must still include every movement type so Closing stays
 *          chronologically accurate even for a hypothetical P561 dated
 *          after to_date.
 */

BEGIN;

ALTER TABLE erp_inventory.stock_history_bucket_map
  ADD COLUMN is_opening_source boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_inventory.stock_history_bucket_map.is_opening_source IS
  'True for the Opening Stock movement family (P561-566). These postings are ALWAYS excluded from every bucket column / in-range total and instead always fold into the Opening figure, regardless of where their own posting_date falls relative to the report''s date range (feasibility §130.2 correction, 2026-08-25).';

UPDATE erp_inventory.stock_history_bucket_map
SET is_opening_source = true
WHERE movement_type_code IN ('P561', 'P562', 'P563', 'P564', 'P565', 'P566');

CREATE OR REPLACE FUNCTION erp_inventory.get_stock_history(
  p_company_id uuid,
  p_from_date date,
  p_to_date date,
  p_material_type_codes text[] DEFAULT NULL,
  p_material_ids uuid[] DEFAULT NULL,
  p_storage_location_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  material_id uuid,
  stock_type_code text,
  storage_location_id uuid,
  opening numeric,
  closing numeric,
  buckets jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = erp_inventory, erp_master, public
AS $$
  WITH scoped_materials AS (
    SELECT m.id
    FROM erp_master.material_master m
    WHERE (p_material_type_codes IS NULL OR array_length(p_material_type_codes, 1) IS NULL OR m.material_type = ANY (p_material_type_codes))
      AND (p_material_ids IS NULL OR array_length(p_material_ids, 1) IS NULL OR m.id = ANY (p_material_ids))
  ),
  scoped_ledger AS (
    SELECT sl.material_id, sl.stock_type_code, sl.storage_location_id, sl.posting_date, sl.direction, sl.quantity,
           bm.bucket_code, COALESCE(bm.is_opening_source, false) AS is_opening_source
    FROM erp_inventory.stock_ledger sl
    JOIN scoped_materials sm ON sm.id = sl.material_id
    LEFT JOIN erp_inventory.stock_history_bucket_map bm ON bm.movement_type_code = sl.movement_type_code
    WHERE sl.company_id = p_company_id
      AND (p_storage_location_ids IS NULL OR array_length(p_storage_location_ids, 1) IS NULL OR sl.storage_location_id = ANY (p_storage_location_ids))
      AND sl.posting_date <= p_to_date
  ),
  ledger_full AS (
    SELECT sl.material_id, sl.stock_type_code, sl.storage_location_id, sl.posting_date, sl.direction, sl.quantity,
           bm.bucket_code
    FROM erp_inventory.stock_ledger sl
    JOIN scoped_materials sm ON sm.id = sl.material_id
    LEFT JOIN erp_inventory.stock_history_bucket_map bm ON bm.movement_type_code = sl.movement_type_code
    WHERE sl.company_id = p_company_id
      AND (p_storage_location_ids IS NULL OR array_length(p_storage_location_ids, 1) IS NULL OR sl.storage_location_id = ANY (p_storage_location_ids))
      AND sl.posting_date > p_to_date
  ),
  after_range_real AS (
    SELECT material_id, stock_type_code, storage_location_id,
           SUM(CASE WHEN direction = 'IN' THEN quantity ELSE -quantity END) AS amount
    FROM ledger_full
    GROUP BY 1, 2, 3
  ),
  in_range_by_bucket AS (
    SELECT material_id, stock_type_code, storage_location_id, bucket_code,
           SUM(CASE WHEN direction = 'IN' THEN quantity ELSE -quantity END) AS amount
    FROM scoped_ledger
    WHERE posting_date >= p_from_date
      AND is_opening_source = false
    GROUP BY 1, 2, 3, 4
  ),
  in_range_total AS (
    SELECT material_id, stock_type_code, storage_location_id, SUM(amount) AS amount
    FROM in_range_by_bucket
    GROUP BY 1, 2, 3
  ),
  current_balance AS (
    SELECT ss.material_id, ss.stock_type_code, ss.storage_location_id, ss.quantity AS amount
    FROM erp_inventory.stock_snapshot ss
    JOIN scoped_materials sm ON sm.id = ss.material_id
    WHERE ss.company_id = p_company_id
      AND (p_storage_location_ids IS NULL OR array_length(p_storage_location_ids, 1) IS NULL OR ss.storage_location_id = ANY (p_storage_location_ids))
  ),
  groups AS (
    SELECT material_id, stock_type_code, storage_location_id FROM current_balance
    UNION
    SELECT material_id, stock_type_code, storage_location_id FROM after_range_real
    UNION
    SELECT material_id, stock_type_code, storage_location_id FROM in_range_total
  )
  SELECT
    g.material_id, g.stock_type_code, g.storage_location_id,
    (COALESCE(cb.amount, 0) - COALESCE(ar.amount, 0) - COALESCE(irt.amount, 0)) AS opening,
    (COALESCE(cb.amount, 0) - COALESCE(ar.amount, 0)) AS closing,
    COALESCE(
      (SELECT jsonb_object_agg(b.bucket_code, b.amount)
         FROM in_range_by_bucket b
        WHERE b.material_id = g.material_id AND b.stock_type_code = g.stock_type_code
          AND b.storage_location_id = g.storage_location_id AND b.bucket_code IS NOT NULL),
      '{}'::jsonb
    ) AS buckets
  FROM groups g
  LEFT JOIN current_balance cb ON cb.material_id = g.material_id AND cb.stock_type_code = g.stock_type_code AND cb.storage_location_id = g.storage_location_id
  LEFT JOIN after_range_real ar ON ar.material_id = g.material_id AND ar.stock_type_code = g.stock_type_code AND ar.storage_location_id = g.storage_location_id
  LEFT JOIN in_range_total irt ON irt.material_id = g.material_id AND irt.stock_type_code = g.stock_type_code AND irt.storage_location_id = g.storage_location_id;
$$;

GRANT EXECUTE ON FUNCTION erp_inventory.get_stock_history(uuid, date, date, text[], uuid[], uuid[]) TO service_role;

COMMIT;
