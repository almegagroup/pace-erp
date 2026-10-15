/*
 * Migration: 20261015100000_erp_planning_prodshade_groups
 * Purpose:   MTS Customer Plan "Product Group" (owner, 2026-10-15).
 *   Two-level grouping of Prodshades, per company:
 *     Mother group  →  Child group  →  Prodshade
 *   * A Prodshade belongs to at most ONE child group (PK on company+prodshade).
 *   * A child group belongs to exactly ONE mother group (NOT NULL FK).
 *   * New Prodshades simply have no membership until a user adds them.
 *   All three tabs show Mother / Child group on the left; Tab 1 and Tab 3 add
 *   Prodshade / Child / Mother total rows. Planning-only master data — it
 *   never touches material master, Stroke Master or production.
 *
 *   The save function is in 20261015110000 (soft delete, is_active).
 */

BEGIN;

CREATE TABLE erp_planning.prodshade_mother_group (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES erp_master.companies(id),
  group_name  text NOT NULL CHECK (btrim(group_name) <> '' AND length(group_name) <= 120),
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_prodshade_mother_group_name
  ON erp_planning.prodshade_mother_group (company_id, lower(btrim(group_name)));

CREATE TABLE erp_planning.prodshade_child_group (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES erp_master.companies(id),
  mother_group_id uuid NOT NULL REFERENCES erp_planning.prodshade_mother_group(id),
  group_name      text NOT NULL CHECK (btrim(group_name) <> '' AND length(group_name) <= 120),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_prodshade_child_group_name
  ON erp_planning.prodshade_child_group (company_id, lower(btrim(group_name)));
CREATE INDEX ix_prodshade_child_group_mother ON erp_planning.prodshade_child_group (mother_group_id);

CREATE TABLE erp_planning.prodshade_group_member (
  company_id            uuid NOT NULL REFERENCES erp_master.companies(id),
  prodshade_material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  child_group_id        uuid NOT NULL REFERENCES erp_planning.prodshade_child_group(id),
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, prodshade_material_id)
);
CREATE INDEX ix_prodshade_group_member_child ON erp_planning.prodshade_group_member (child_group_id);

COMMENT ON TABLE erp_planning.prodshade_mother_group IS 'MTS planning Product Group, top level (per company).';
COMMENT ON TABLE erp_planning.prodshade_child_group IS 'MTS planning Product Group, second level; exactly one mother group.';
COMMENT ON TABLE erp_planning.prodshade_group_member IS 'Prodshade → child group; one group per Prodshade per company.';

ALTER TABLE erp_planning.prodshade_mother_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_planning.prodshade_child_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_planning.prodshade_group_member ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON erp_planning.prodshade_mother_group TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON erp_planning.prodshade_child_group TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON erp_planning.prodshade_group_member TO service_role;

-- Save function: see 20261015110000_erp_planning_prodshade_groups_soft_delete.sql
-- (soft delete; the first version with hard DELETEs was never created anywhere).

COMMIT;
