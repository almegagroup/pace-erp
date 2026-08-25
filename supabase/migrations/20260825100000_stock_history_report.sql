/*
 * Purpose: Stock History report (Inventory group, feasibility §130). Movement
 *          type -> business bucket mapping (§130.5) stored as data, not a
 *          hardcoded CASE ladder, so it stays a one-line change if a new
 *          movement_type_master code is ever added. get_stock_history()
 *          computes Opening/Closing per (material, stock status, storage
 *          location) backward from stock_snapshot's current balance (§130.2)
 *          -- cost is bounded by "today back to the report's end date", not
 *          by a material's total ledger history.
 */

BEGIN;

CREATE TABLE erp_inventory.stock_history_bucket_map (
  movement_type_code text PRIMARY KEY REFERENCES erp_inventory.movement_type_master(code),
  bucket_code text NOT NULL CHECK (bucket_code IN (
    'INWARD', 'CONS', 'SALE_DISPATCH', 'PID', 'QA', 'REJECT',
    'RETURN', 'RTV', 'SCRAP', 'REPROCESS', 'TRANSFER'
  ))
);

COMMENT ON TABLE erp_inventory.stock_history_bucket_map IS
  'Feasibility §130.5 -- which business-event column a raw movement_type_master code rolls up into for the Stock History report. A movement code and its own reversal always share the same bucket_code (the ledger direction sign nets them automatically, no separate reversal flag needed here).';

INSERT INTO erp_inventory.stock_history_bucket_map (movement_type_code, bucket_code) VALUES
  ('P101', 'INWARD'), ('P102', 'INWARD'),
  ('P561', 'INWARD'), ('P562', 'INWARD'),
  ('P563', 'INWARD'), ('P564', 'INWARD'),
  ('P565', 'INWARD'), ('P566', 'INWARD'),
  ('P261', 'CONS'), ('P262', 'CONS'),
  ('P601', 'SALE_DISPATCH'), ('P602', 'SALE_DISPATCH'),
  ('P701', 'PID'), ('P711', 'PID'),
  ('P702', 'PID'), ('P712', 'PID'),
  ('P703', 'PID'), ('P713', 'PID'),
  ('P704', 'PID'), ('P714', 'PID'),
  ('P705', 'PID'), ('P715', 'PID'),
  ('P706', 'PID'), ('P716', 'PID'),
  ('P321', 'QA'), ('P322', 'QA'), ('P323', 'QA'), ('P349', 'QA'),
  ('P344', 'REJECT'), ('P343', 'REJECT'),
  ('P651', 'RETURN'), ('P652', 'RETURN'),
  ('P653', 'RETURN'), ('P654', 'RETURN'),
  ('P655', 'RETURN'), ('P656', 'RETURN'),
  ('P657', 'RETURN'), ('P658', 'RETURN'),
  ('P122', 'RTV'), ('P123', 'RTV'),
  ('P124', 'RTV'), ('P125', 'RTV'),
  ('P551', 'SCRAP'), ('P552', 'SCRAP'),
  ('P553', 'SCRAP'), ('P554', 'SCRAP'),
  ('P555', 'SCRAP'), ('P556', 'SCRAP'),
  ('P901', 'REPROCESS'), ('P902', 'REPROCESS'),
  ('P903', 'REPROCESS'), ('P904', 'REPROCESS'),
  ('P905', 'REPROCESS'), ('P906', 'REPROCESS'),
  ('P311', 'TRANSFER'), ('P312', 'TRANSFER'),
  ('P301', 'TRANSFER'), ('P302', 'TRANSFER'),
  ('P303', 'TRANSFER'), ('P304', 'TRANSFER'),
  ('P305', 'TRANSFER'), ('P306', 'TRANSFER');

-- Guard so a future movement_type_master addition can never silently fall
-- through this report with no bucket assignment (CLAUDE.md's "small config
-- trap" pattern -- verified against the live catalog, not memory, at build
-- time; this check re-verifies it forever after).
DO $$
DECLARE
  unmapped_count integer;
BEGIN
  SELECT count(*) INTO unmapped_count
  FROM erp_inventory.movement_type_master mt
  LEFT JOIN erp_inventory.stock_history_bucket_map bm ON bm.movement_type_code = mt.code
  WHERE mt.active AND bm.movement_type_code IS NULL;
  IF unmapped_count > 0 THEN
    RAISE EXCEPTION 'stock_history_bucket_map is missing % active movement_type_master code(s)', unmapped_count;
  END IF;
END $$;

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
           bm.bucket_code
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
