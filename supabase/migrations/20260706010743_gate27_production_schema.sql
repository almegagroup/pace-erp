/*
 * Migration: 20260706010743_gate27_production_schema
 * Gate: 27
 * Purpose: Create erp_production schema with all L3 production tables.
 *          Adds P231/P232 movement types (Production Receipt/Reversal).
 *          Adds PROC_PO and PACK_PO document series placeholders.
 */

BEGIN;

-- ── SCHEMA ─────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS erp_production;

GRANT USAGE ON SCHEMA erp_production TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA erp_production
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA erp_production
  GRANT ALL ON SEQUENCES TO service_role;

-- ── 1. PACK CODE MASTER ─────────────────────────────────────────────────────
-- SA-managed. 4 codes: 599 (barrel/PER_UNIT), 510 (IBC/PER_KG), 000 (tanker/PER_KG), 001 (MTEST/PER_UNIT)
CREATE TABLE erp_production.pack_code_master (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_code      TEXT        NOT NULL UNIQUE,
  pack_name      TEXT        NOT NULL,
  pack_type      TEXT        NOT NULL
    CHECK (pack_type IN ('BARREL','IBC','TANKER','MTEST')),
  billing_uom    TEXT        NOT NULL
    CHECK (billing_uom IN ('PER_UNIT','PER_KG')),
  active         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. STROKE MASTER ────────────────────────────────────────────────────────
-- Header: company + prodshade (FG material) + stroke number (numeric string)
-- Status: DRAFT (QA creates, Manager edits) → APPROVED (Manager saves)
CREATE TABLE erp_production.stroke_master (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID        NOT NULL
    REFERENCES erp_master.projects(id),
  prodshade_material_id   UUID        NOT NULL
    REFERENCES erp_master.material_master(id),
  stroke_number           TEXT        NOT NULL,        -- numeric-only string
  description             TEXT,
  status                  TEXT        NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','APPROVED')),
  created_by              UUID        NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by             UUID,
  approved_at             TIMESTAMPTZ,
  last_updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_by         UUID,
  UNIQUE (company_id, prodshade_material_id, stroke_number)
);

-- ── 3. STROKE LINE ──────────────────────────────────────────────────────────
-- RM lines — same RM can appear twice (no unique on material_id)
-- dosage_pct across all lines for a stroke must sum to 100 (enforced in app)
CREATE TABLE erp_production.stroke_line (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  stroke_master_id UUID           NOT NULL
    REFERENCES erp_production.stroke_master(id) ON DELETE CASCADE,
  material_id      UUID           NOT NULL
    REFERENCES erp_master.material_master(id),
  alternate_material_id UUID
    REFERENCES erp_master.material_master(id),
  dosage_pct       NUMERIC(10,4)  NOT NULL
    CHECK (dosage_pct > 0 AND dosage_pct <= 100),
  display_order    INTEGER        NOT NULL DEFAULT 0
);

-- ── 4. PRODSHADE PACK CONFIG ─────────────────────────────────────────────────
-- Which pack codes are allowed per company+prodshade, and fill qty per pack.
-- Prerequisite: config must exist before a Process PO can be created.
CREATE TABLE erp_production.prodshade_pack_config (
  id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID           NOT NULL
    REFERENCES erp_master.projects(id),
  material_id    UUID           NOT NULL
    REFERENCES erp_master.material_master(id),       -- FG material (prodshade)
  pack_code_id   UUID           NOT NULL
    REFERENCES erp_production.pack_code_master(id),
  fill_qty       NUMERIC(14,4),                       -- KG per unit for 599/IBC
  active         BOOLEAN        NOT NULL DEFAULT TRUE,
  created_by     UUID           NOT NULL,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, material_id, pack_code_id)
);

-- ── 5. BATCH NUMBER SERIES ──────────────────────────────────────────────────
-- SA config: prefix + count per company / batch_type / prodshade.
-- MTO and MTEST: company-level (prodshade_material_id IS NULL).
-- HPS and IWC: per-prodshade (prodshade_material_id NOT NULL).
CREATE TABLE erp_production.batch_number_series (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL
    REFERENCES erp_master.projects(id),
  prodshade_material_id UUID
    REFERENCES erp_master.material_master(id),       -- NULL = company-level
  batch_type            TEXT        NOT NULL
    CHECK (batch_type IN ('MTO','HPS','IWC','MTEST')),
  prefix                TEXT        NOT NULL,
  current_count         INTEGER     NOT NULL DEFAULT 0 CHECK (current_count >= 0),
  fy_reset              BOOLEAN     NOT NULL DEFAULT TRUE,
  active                BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by            UUID        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique: company-level entries (NULL prodshade)
CREATE UNIQUE INDEX ux_batch_series_company_level
  ON erp_production.batch_number_series (company_id, batch_type)
  WHERE prodshade_material_id IS NULL;

-- Partial unique: prodshade-level entries
CREATE UNIQUE INDEX ux_batch_series_prodshade_level
  ON erp_production.batch_number_series (company_id, batch_type, prodshade_material_id)
  WHERE prodshade_material_id IS NOT NULL;

-- ── 6. PRODUCTION SEGMENT LOCATION CONFIG ──────────────────────────────────
-- SA/Manager config: company + segment → rm/pm/shopfloor/fg storage locations
-- Used at Process PO Verify to determine which sloc issues come from / go to.
CREATE TABLE erp_production.production_segment_location_config (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID        NOT NULL
    REFERENCES erp_master.projects(id),
  segment_code     TEXT        NOT NULL,              -- ADMIX, HPS, IWC, POWDER, INT
  rm_sloc_id       UUID
    REFERENCES erp_inventory.storage_location_master(id),
  pm_sloc_id       UUID
    REFERENCES erp_inventory.storage_location_master(id),
  shopfloor_sloc_id UUID
    REFERENCES erp_inventory.storage_location_master(id),
  fg_sloc_id       UUID
    REFERENCES erp_inventory.storage_location_master(id),
  active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by       UUID        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_by  UUID,
  UNIQUE (company_id, segment_code)
);

-- ── 7. PLAN FEED (Factory Orders) ───────────────────────────────────────────
-- FO management page (83.18). Links to Packing POs later.
CREATE TABLE erp_production.plan_feed (
  id                       UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID           NOT NULL
    REFERENCES erp_master.projects(id),
  fo_number                TEXT           NOT NULL,   -- manually entered
  party_id                 UUID,                      -- optional: link to vendor/customer
  party_name               TEXT,                      -- stored for display
  material_id              UUID           NOT NULL
    REFERENCES erp_master.material_master(id),        -- FG SKU
  description              TEXT,
  ordered_qty_kg           NUMERIC(14,4)  NOT NULL CHECK (ordered_qty_kg > 0),
  pack_qty                 INTEGER,                   -- number of packs ordered
  order_date               DATE           NOT NULL,
  scheduled_delivery_date  DATE,
  status                   TEXT           NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','CANCELLED')),
  created_by               UUID           NOT NULL,
  created_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  cancelled_by             UUID,
  cancelled_at             TIMESTAMPTZ,
  last_updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  last_updated_by          UUID,
  UNIQUE (company_id, fo_number)
);

-- ── 8. PROCESS ORDER ─────────────────────────────────────────────────────────
-- Core production order (SAP ZCoR1/COR6 equivalent).
-- Types: MTO (Admix), HPS, MTS (IWC/Powder), INT (Caustic Liquid), MTEST (AP Test)
-- Status flow: STANDARD → QA_APPROVED → BATCH_STARTED → FINAL → VERIFIED
--              QA_REJECTED is a terminal rejection (back to STANDARD after fix)
CREATE TABLE erp_production.process_order (
  id                      UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID           NOT NULL
    REFERENCES erp_master.projects(id),
  po_number               TEXT           NOT NULL,
  po_type                 TEXT           NOT NULL
    CHECK (po_type IN ('MTO','HPS','MTS','INT','MTEST')),
  material_id             UUID           NOT NULL
    REFERENCES erp_master.material_master(id),        -- FG or INT material
  stroke_master_id        UUID
    REFERENCES erp_production.stroke_master(id),      -- NULL for INT/MTEST
  planned_qty             NUMERIC(14,4)  NOT NULL CHECK (planned_qty > 0),
  actual_qty              NUMERIC(14,4),              -- set at Verify
  batch_number            TEXT,                       -- set at Start Batch
  status                  TEXT           NOT NULL DEFAULT 'STANDARD'
    CHECK (status IN ('STANDARD','QA_APPROVED','QA_REJECTED','BATCH_STARTED','FINAL','VERIFIED','REVERSED')),
  segment_code            TEXT,                       -- ADMIX, HPS, IWC, POWDER, INT
  issue_sloc_override_id  UUID
    REFERENCES erp_inventory.storage_location_master(id),  -- override at Standard
  plan_feed_id            UUID
    REFERENCES erp_production.plan_feed(id),          -- FO link (optional)
  qa_remarks              TEXT,
  created_by              UUID           NOT NULL,
  created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  qa_decided_by           UUID,
  qa_decided_at           TIMESTAMPTZ,
  batch_started_by        UUID,
  batch_started_at        TIMESTAMPTZ,
  finalized_by            UUID,
  finalized_at            TIMESTAMPTZ,
  verified_by             UUID,
  verified_at             TIMESTAMPTZ,
  reversed_by             UUID,
  reversed_at             TIMESTAMPTZ,
  last_updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  last_updated_by         UUID,
  UNIQUE (company_id, po_number)
);

-- ── 9. PROCESS ORDER LINE ────────────────────────────────────────────────────
-- RM/INT material consumption lines.
-- planned_qty from stroke BOM; actual_qty set at Verify (can differ).
CREATE TABLE erp_production.process_order_line (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  process_order_id UUID           NOT NULL
    REFERENCES erp_production.process_order(id) ON DELETE CASCADE,
  material_id      UUID           NOT NULL
    REFERENCES erp_master.material_master(id),
  planned_qty      NUMERIC(14,4)  NOT NULL CHECK (planned_qty >= 0),
  actual_qty       NUMERIC(14,4),                     -- set at Verify
  issue_sloc_id    UUID
    REFERENCES erp_inventory.storage_location_master(id),
  display_order    INTEGER        NOT NULL DEFAULT 0
);

-- ── 10. PACKING ORDER ────────────────────────────────────────────────────────
-- Packing PO (SAP equivalent). Linked to a Process PO.
-- Types: PMTO/PHPS/PMTS/PTEST
-- Status: STANDARD → FINAL | REVERSED (no QA step for Packing PO)
CREATE TABLE erp_production.packing_order (
  id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID           NOT NULL
    REFERENCES erp_master.projects(id),
  po_number         TEXT           NOT NULL,
  po_type           TEXT           NOT NULL
    CHECK (po_type IN ('PMTO','PHPS','PMTS','PTEST')),
  process_order_id  UUID           NOT NULL
    REFERENCES erp_production.process_order(id),
  material_id       UUID           NOT NULL
    REFERENCES erp_master.material_master(id),        -- FG SKU
  pack_code_id      UUID           NOT NULL
    REFERENCES erp_production.pack_code_master(id),
  fill_qty_per_pack NUMERIC(14,4),                    -- KG per barrel (for 599)
  num_packs         INTEGER,                          -- number of packs at Standard
  planned_qty_kg    NUMERIC(14,4),                    -- total planned KG
  actual_qty_kg     NUMERIC(14,4),                    -- set at Final
  status            TEXT           NOT NULL DEFAULT 'STANDARD'
    CHECK (status IN ('STANDARD','FINAL','REVERSED')),
  plan_feed_id      UUID
    REFERENCES erp_production.plan_feed(id),          -- FO link (optional)
  segment_code      TEXT,
  created_by        UUID           NOT NULL,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  finalized_by      UUID,
  finalized_at      TIMESTAMPTZ,
  reversed_by       UUID,
  reversed_at       TIMESTAMPTZ,
  last_updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  last_updated_by   UUID,
  UNIQUE (company_id, po_number)
);

-- ── 11. PACKING ORDER LINE ───────────────────────────────────────────────────
-- Two line types:
--   SFG — the semi-finished good (from Process PO batch, in S003)
--   PM  — packing material (barrel, label, etc.)
CREATE TABLE erp_production.packing_order_line (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  packing_order_id UUID           NOT NULL
    REFERENCES erp_production.packing_order(id) ON DELETE CASCADE,
  line_type        TEXT           NOT NULL
    CHECK (line_type IN ('SFG','PM')),
  material_id      UUID           NOT NULL
    REFERENCES erp_master.material_master(id),
  batch_number     TEXT,                              -- for SFG lines (which batch to consume)
  qty_per_pack     NUMERIC(14,4),                    -- for PM no-BOM lines (qty per barrel/unit)
  total_qty        NUMERIC(14,4)  NOT NULL CHECK (total_qty >= 0),
  actual_qty       NUMERIC(14,4),                    -- set at Final
  issue_sloc_id    UUID
    REFERENCES erp_inventory.storage_location_master(id),
  display_order    INTEGER        NOT NULL DEFAULT 0
);

-- ── INDEXES ──────────────────────────────────────────────────────────────────
CREATE INDEX idx_stroke_master_company   ON erp_production.stroke_master (company_id);
CREATE INDEX idx_stroke_master_prodshade ON erp_production.stroke_master (prodshade_material_id);
CREATE INDEX idx_stroke_line_master      ON erp_production.stroke_line (stroke_master_id);
CREATE INDEX idx_pack_config_company     ON erp_production.prodshade_pack_config (company_id);
CREATE INDEX idx_pack_config_material    ON erp_production.prodshade_pack_config (material_id);
CREATE INDEX idx_plan_feed_company       ON erp_production.plan_feed (company_id);
CREATE INDEX idx_plan_feed_material      ON erp_production.plan_feed (material_id);
CREATE INDEX idx_plan_feed_status        ON erp_production.plan_feed (status);
CREATE INDEX idx_process_order_company   ON erp_production.process_order (company_id);
CREATE INDEX idx_process_order_status    ON erp_production.process_order (status);
CREATE INDEX idx_process_order_material  ON erp_production.process_order (material_id);
CREATE INDEX idx_process_order_stroke    ON erp_production.process_order (stroke_master_id);
CREATE INDEX idx_packing_order_company   ON erp_production.packing_order (company_id);
CREATE INDEX idx_packing_order_process   ON erp_production.packing_order (process_order_id);
CREATE INDEX idx_packing_order_status    ON erp_production.packing_order (status);

-- ── MOVEMENT TYPES (P231/P232) ───────────────────────────────────────────────
-- P231: Production Receipt — posts FG/SFG into target location (S003 or F003)
-- P261/P262 already exist for GI (issue) to production orders
INSERT INTO erp_inventory.movement_type_master
  (code, name, direction, source_stock_type, target_stock_type,
   reference_document_required, reference_document_type,
   reversal_of, reversed_by, role_restricted, approval_required, is_custom, active)
VALUES
  ('P231', 'Production Receipt - FG/SFG',
   'IN',  NULL,            'UNRESTRICTED',
   false, NULL, NULL, 'P232', false, false, false, true),
  ('P232', 'P231 Reversal — Production Receipt Reversal',
   'OUT', 'UNRESTRICTED',  NULL,
   false, NULL, 'P231', NULL, false, false, false, true);

COMMIT;
