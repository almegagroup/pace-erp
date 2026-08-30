-- The unified SO03 API records every selected SO/STO in this private join
-- table. The Edge Function uses the service role, which needs explicit DML
-- privileges because this schema does not inherit public-schema grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE erp_procurement.delivery_challan_source TO service_role;
