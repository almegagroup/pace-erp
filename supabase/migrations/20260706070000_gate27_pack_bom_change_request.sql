/*
 * Migration: 20260706070000_gate27_pack_bom_change_request
 * Gate: 27
 * Purpose: Pack BOM tables (pack_bom, pack_bom_line) + change request tables + FG material sequence.
 *          pack_bom and pack_bom_line were created via MCP on dev; included here for prod deployment.
 */

-- FG material numbering sequence (used by pack_config upsert to auto-create FG SKUs)
CREATE SEQUENCE IF NOT EXISTS erp_master.fg_material_seq
  START 1 INCREMENT 1 MINVALUE 1 NO MAXVALUE;

-- Pack BOM header (one per FG SKU)
CREATE TABLE IF NOT EXISTS erp_production.pack_bom (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku_material_id UUID        NOT NULL REFERENCES erp_master.material_master(id),
  status          TEXT        NOT NULL DEFAULT 'DRAFT'
                              CHECK (status IN ('DRAFT', 'ACTIVE', 'REJECTED')),
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by     UUID,
  approved_at     TIMESTAMPTZ,
  reject_reason   TEXT
);

-- Pack BOM lines (INPUT = PM components, OUTPUT = FG SKU)
CREATE TABLE IF NOT EXISTS erp_production.pack_bom_line (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pack_bom_id       UUID        NOT NULL REFERENCES erp_production.pack_bom(id),
  line_type         TEXT        NOT NULL DEFAULT 'INPUT'
                                CHECK (line_type IN ('OUTPUT', 'INPUT')),
  material_id       UUID        NOT NULL REFERENCES erp_master.material_master(id),
  qty               NUMERIC,
  uom_code          TEXT,
  has_alternate     BOOLEAN     NOT NULL DEFAULT FALSE,
  material_group_id UUID,
  display_order     INTEGER     NOT NULL DEFAULT 0
);

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
