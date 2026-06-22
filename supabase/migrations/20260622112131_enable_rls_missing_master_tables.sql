-- These tables were created without RLS enabled, violating the project's
-- default-deny rule (service_role bypasses RLS via BYPASSRLS, so backend
-- access is unaffected; this only closes the anon/authenticated gap).

ALTER TABLE erp_master.vendor_material_uom ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.vendor_material_currency ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.vendor_material_payment_term ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.parent_customer_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.parent_customer_code_sequence ENABLE ROW LEVEL SECURITY;

CREATE POLICY backend_only ON erp_master.vendor_material_uom FOR ALL USING (false);
CREATE POLICY backend_only ON erp_master.vendor_material_currency FOR ALL USING (false);
CREATE POLICY backend_only ON erp_master.vendor_material_payment_term FOR ALL USING (false);
CREATE POLICY backend_only ON erp_master.parent_customer_master FOR ALL USING (false);
CREATE POLICY backend_only ON erp_master.parent_customer_code_sequence FOR ALL USING (false);
