-- File-Path: supabase/migrations/20260827110000_mm05_retire_dead_tables.sql
-- Purpose: feasibility doc Section 132 (132.5 point 6) -- MM05 full retirement.
--          fg_dispatch_customer / fg_dispatch_customer_address were built
--          2026-07-31 for MM05's original "FG Dispatch Customer" design
--          (§114.12-114.16) but never used in practice -- 0 rows in dev/prod
--          both, confirmed live 2026-08-27 before this drop. MM04
--          (customer_master) is now the single unified Customer Master
--          (§132.5), so this identity table is permanently unneeded.
--          erp_master.fg_parent_company / fg_depot_code are NOT touched --
--          those stay, shared with MM04 (§129.2, unchanged).
-- Authority: Backend

DROP TABLE IF EXISTS erp_master.fg_dispatch_customer_address;
DROP TABLE IF EXISTS erp_master.fg_dispatch_customer;
