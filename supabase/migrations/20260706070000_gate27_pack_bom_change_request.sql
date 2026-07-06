/*
 * Migration: 20260706070000_gate27_pack_bom_change_request
 * Gate: 27
 * Purpose: Pack BOM change request tables + FG material sequence.
 *          Applied to dev via MCP; this file tracks the schema for prod deployment.
 */

-- FG material numbering sequence (used by pack_config upsert to auto-create FG SKUs)
CREATE SEQUENCE IF NOT EXISTS erp_master.fg_material_seq
  START 1 INCREMENT 1 MINVALUE 1 NO MAXVALUE;

-- Pack BOM change requests (PR07 creates → PR08 approves/rejects)
CREATE TABLE IF NOT EXISTS erp_production.pack_bom_change_request (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pack_bom_id   UUID        NOT NULL REFERENCES erp_production.pack_bom(id),
  status        TEXT        NOT NULL DEFAULT 'DRAFT'
                            CHECK (status IN ('DRAFT', 'APPROVED', 'REJECTED')),
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by   UUID,
  approved_at   TIMESTAMPTZ,
  reject_reason TEXT
);

-- Lines describing each proposed change (ADD/REMOVE/EDIT on pack_bom_line rows)
CREATE TABLE IF NOT EXISTS erp_production.pack_bom_change_request_line (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  change_request_id UUID        NOT NULL REFERENCES erp_production.pack_bom_change_request(id),
  action            TEXT        NOT NULL CHECK (action IN ('ADD', 'REMOVE', 'EDIT')),
  bom_line_id       UUID        REFERENCES erp_production.pack_bom_line(id),
  material_id       UUID,
  qty               NUMERIC,
  uom_code          TEXT,
  has_alternate     BOOLEAN     NOT NULL DEFAULT FALSE,
  material_group_id UUID,
  display_order     INTEGER     NOT NULL DEFAULT 0
);
