-- File-Path: supabase/migrations/20260822160000_fg_parent_company_multi_company_map.sql
-- Purpose: fg_parent_company.company_id (single FK) means a real-world Bill-To
--   entity created under one PACE company can never be reused by another --
--   forces duplicate rows for the same business (business owner, 2026-08-22).
--   Mirrors customer_company_map exactly (many-to-many, same shape) so the
--   SAME Parent Company row can be shared across companies without
--   duplication, while still only being visible/usable by mapped companies.
--   fg_parent_company.company_id itself is left in place (not dropped) --
--   it becomes "which company originally created this row", audit-only;
--   the map table is the real scoping authority going forward.
-- Authority: Backend (feasibility doc Section 129, LOCKED 2026-08-22)

CREATE TABLE erp_master.fg_parent_company_company_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_company_id uuid NOT NULL REFERENCES erp_master.fg_parent_company(id),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_company_id, company_id)
);

CREATE INDEX idx_fg_parent_company_company_map_parent ON erp_master.fg_parent_company_company_map(parent_company_id);
CREATE INDEX idx_fg_parent_company_company_map_company ON erp_master.fg_parent_company_company_map(company_id);

-- Seed: every existing fg_parent_company row's own company_id becomes its
-- first map entry, so nothing that already works today loses access.
INSERT INTO erp_master.fg_parent_company_company_map (parent_company_id, company_id, active)
SELECT id, company_id, true FROM erp_master.fg_parent_company;
