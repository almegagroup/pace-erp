-- Parent Company / VDC / DC are global masters (feasibility §129, corrected
-- 2026-08-27 per business owner directive): a Parent Company is created once
-- and is usable from every company, never re-mapped per company. The
-- fg_parent_company_company_map many-to-many table existed only to gate
-- per-company visibility/access -- that gate is retired (backend handlers
-- no longer read or write this table; access is governed purely by the
-- caller's OM_CUSTOMER_LIST/OM_CUSTOMER_CREATE ACL grant at their own
-- company, same as the rest of MM04). No other table has an FK into this
-- one (verified before dropping).
DROP TABLE IF EXISTS erp_master.fg_parent_company_company_map;
