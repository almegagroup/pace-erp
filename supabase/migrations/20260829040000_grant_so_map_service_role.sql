-- SO Map's allocation table was created after the procurement schema's
-- original privilege grant. Give the backend role explicit current and
-- future-table access so mapping reads and writes remain server-authoritative.
BEGIN;

GRANT USAGE ON SCHEMA erp_procurement TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
ON erp_procurement.sales_order_map_allocation
TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_procurement
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
