-- FG STO: the AC04 conversion cost resolved at create time was never persisted.
--
-- createFgStoHandler resolves conversion_cost_per_unit (AC04, per base UoM) and sends it in each line, but
-- create_sto_atomic's INSERT INTO stock_transfer_order_line listed no such column, so every FG STO line
-- got NULL. The cost only matters to the RECEIVER (GRN valuation = transfer_price + conversion_cost); the
-- sender's DO / invoice rate is the transfer price alone (business owner, 2026-11-04) -- that side is
-- changed in the application code in the same release.
--
-- The new INSERT is derived from the LIVE function body (same replace-the-definition pattern the 20261030170000
-- migration uses) so nothing else in create_sto_atomic can drift. Idempotent.
DO $migration$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('erp_procurement.create_sto_atomic(jsonb,jsonb)'::regprocedure) INTO v_def;
  IF position('conversion_cost_per_unit' IN v_def) > 0 THEN
    RETURN; -- already persisted
  END IF;
  IF position('expected_delivery_date, balance_qty) SELECT' IN v_def) = 0
     OR position('r.expected_delivery_date, r.balance_qty FROM jsonb_populate_record(NULL::erp_procurement.stock_transfer_order_line, l)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'create_sto_atomic line INSERT not found; refusing an incomplete upgrade';
  END IF;
  v_def := replace(v_def, 'expected_delivery_date, balance_qty) SELECT', 'expected_delivery_date, balance_qty, conversion_cost_per_unit) SELECT');
  v_def := replace(v_def, 'r.expected_delivery_date, r.balance_qty FROM jsonb_populate_record(NULL::erp_procurement.stock_transfer_order_line, l)',
                          'r.expected_delivery_date, r.balance_qty, r.conversion_cost_per_unit FROM jsonb_populate_record(NULL::erp_procurement.stock_transfer_order_line, l)');
  EXECUTE v_def;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
