-- Import Lead Time Master no longer needs Material Category — sail/clearance
-- time is tracked purely by Vendor + Port of Discharge. If a future need
-- arises for material-level (atomic) granularity, this can be reintroduced
-- then with real requirements driving the design.

ALTER TABLE erp_master.lead_time_master_import
  DROP COLUMN IF EXISTS material_category_id;
