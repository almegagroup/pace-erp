-- Real live bug, found 2026-08-22: migration 20260821090000 created
-- erp_procurement.deduction_type_master and erp_procurement.
-- landed_cost_deduction_line but never granted service_role access to
-- either -- every recent new-table migration in this repo (e.g.
-- 20260817040750) includes `GRANT ALL ON <table> TO service_role;`
-- immediately after CREATE TABLE, this one simply missed it. Both tables
-- had zero grants beyond the `postgres` owner (confirmed via
-- information_schema.role_table_grants in prod), so PostgREST/serviceRoleClient
-- 500'd with "42501 permission denied for table landed_cost_deduction_line"
-- on any company with real landed-cost data -- deduction_type_master hit
-- the identical gap but hadn't yet been exercised by a real query.

GRANT ALL ON erp_procurement.deduction_type_master TO service_role;
GRANT ALL ON erp_procurement.landed_cost_deduction_line TO service_role;
