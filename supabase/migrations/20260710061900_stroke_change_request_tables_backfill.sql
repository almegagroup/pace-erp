/*
 * Migration: 20260710061900_stroke_change_request_tables_backfill
 * Gate: 27.3
 * Purpose: Reconcile another confirmed MCP-vs-Migration violation, found while
 *          preparing the first prod deploy (2026-07-26): erp_production.
 *          stroke_change_request and stroke_change_request_line were created
 *          directly on dev via MCP execute_sql and NEVER had any migration at
 *          all. Replaying migrations in order on a fresh database (prod)
 *          reaches 20260710061955_gate27_stroke_change_request_group_fkeys.sql
 *          (which ALTERs stroke_change_request_line to add two FKs) before
 *          the table itself exists, and fails with
 *          "relation \"erp_production.stroke_change_request_line\" does not exist".
 *
 *          Reconstructed column-for-column, constraint-for-constraint from
 *          dev's live information_schema/pg_constraint (2026-07-26). The
 *          old_group_id/new_group_id FKs are deliberately NOT added here —
 *          20260710061955 (which runs immediately after this one) already adds
 *          them; adding them here too would double-add and fail on the
 *          duplicate constraint name.
 *
 * ⚠️ Placed at 20260710061900, deliberately BEFORE 20260710061955.
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_production.stroke_change_request (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stroke_master_id UUID        NOT NULL
    REFERENCES erp_production.stroke_master(id),
  company_id       UUID        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'REJECTED')),
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by      UUID,
  approved_at      TIMESTAMPTZ,
  reject_reason    TEXT
);

CREATE TABLE IF NOT EXISTS erp_production.stroke_change_request_line (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id  UUID    NOT NULL
    REFERENCES erp_production.stroke_change_request(id) ON DELETE CASCADE,
  stroke_line_id      UUID    NOT NULL
    REFERENCES erp_production.stroke_line(id),
  old_material_id    UUID,
  new_material_id    UUID,
  old_has_alternate  BOOLEAN,
  new_has_alternate  BOOLEAN,
  old_group_id       UUID,
  new_group_id       UUID,
  display_order      INTEGER NOT NULL DEFAULT 0
);

COMMIT;
