-- Section 124 follow-up: stock_ledger.posted_quantity/posted_value were built as
-- GENERATED ALWAYS AS (...) STORED columns. Confirmed live in prod (2026-08-18) that
-- PostgREST rejects any select() that includes them -- both IN02 (STOCK_LEDGER_FETCH_FAILED)
-- and PR24 (PROD_OIS_LEDGER_FETCH_FAILED) 500'd on the fetch step, reproducibly, hours after
-- the schema cache had already reloaded and stabilized (zero postgres_logs/postgrest_logs
-- activity in the failing window -- Postgres never even saw the query, so PostgREST itself
-- was rejecting these two columns before forming SQL). quantity/value (plain columns) never
-- had this problem. This points at a PostgREST-specific limitation with GENERATED STORED
-- columns, not a grants/replica/cache-timing issue (all independently ruled out).
--
-- Fix: convert both to plain columns (DROP EXPRESSION preserves the already-computed data,
-- no backfill needed) and maintain them going forward with a BEFORE INSERT trigger instead of
-- a generation expression. Same guarantee (every row always correct, no per-report CASE WHEN
-- ever needed) via the exact same column mechanism every other stock_ledger column already
-- uses successfully through PostgREST. No UPDATE arm needed -- stock_ledger is append-only
-- (stock_ledger_no_update/stock_ledger_no_delete rules make DML updates a no-op already).

ALTER TABLE erp_inventory.stock_ledger
  ALTER COLUMN posted_quantity DROP EXPRESSION,
  ALTER COLUMN posted_value DROP EXPRESSION;

CREATE OR REPLACE FUNCTION erp_inventory.stock_ledger_set_posted_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.posted_quantity := CASE WHEN NEW.direction = 'OUT' THEN -NEW.quantity ELSE NEW.quantity END;
  NEW.posted_value := CASE WHEN NEW.direction = 'OUT' THEN -NEW.value ELSE NEW.value END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_ledger_set_posted_columns_trigger ON erp_inventory.stock_ledger;
CREATE TRIGGER stock_ledger_set_posted_columns_trigger
  BEFORE INSERT ON erp_inventory.stock_ledger
  FOR EACH ROW
  EXECUTE FUNCTION erp_inventory.stock_ledger_set_posted_columns();

COMMENT ON COLUMN erp_inventory.stock_ledger.posted_quantity IS
  'Signed quantity (negative for OUT, positive for IN) -- maintained by stock_ledger_set_posted_columns_trigger on insert (was a GENERATED column; PostgREST could not serve it, see migration comment). Use SUM(posted_quantity) for any net/running-balance/Reco calculation.';
COMMENT ON COLUMN erp_inventory.stock_ledger.posted_value IS
  'Signed value (negative for OUT, positive for IN) -- maintained by stock_ledger_set_posted_columns_trigger on insert (was a GENERATED column; PostgREST could not serve it, see migration comment). Use SUM(posted_value) for any net/running-balance/Reco calculation.';
