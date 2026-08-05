-- print_log (added in 20260805180000) never received the standard
-- erp_procurement service_role/authenticated grants every other table in
-- this schema has (compare stock_transfer_order) — service_role inserts
-- were failing with "permission denied for table print_log".
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON erp_procurement.print_log TO service_role;
GRANT SELECT ON erp_procurement.print_log TO authenticated;
