/*
 * File-ID: 9.3A
 * File-Path: supabase/migrations/20260315103000_gate9_9_3A_create_company_group_map.sql
 * Gate: 9
 * Phase: 9
 * Domain: MASTER
 * Purpose: Company ↔ Group governance mapping
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- COMPANY ↔ GROUP MAP
-- Governance-only. NOT used for ACL or RLS.
-- ============================================================

CREATE TABLE IF NOT EXISTS erp_map.company_group (
  id          BIGSERIAL PRIMARY KEY,

  company_id UUID NOT NULL,
  group_id   BIGINT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_company_group_company
    FOREIGN KEY (company_id)
    REFERENCES erp_master.companies (id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_company_group_group
    FOREIGN KEY (group_id)
    REFERENCES erp_master.groups (id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE erp_map.company_group IS
'Governance mapping between companies and groups. Not a security boundary.';

-- ------------------------------------------------------------
-- ONE COMPANY → ONE GROUP RULE
-- ------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS ux_company_single_group
ON erp_map.company_group (company_id);

COMMIT;
