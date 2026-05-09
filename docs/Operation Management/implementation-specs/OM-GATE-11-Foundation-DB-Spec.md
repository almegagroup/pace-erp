# OM-GATE-11 — Foundation DB Spec
# PACE-ERP Operation Management — erp_inventory Schema

**Gate:** 11
**Phase:** Operation Management — Layer 1 Foundation
**Status:** FROZEN — Ready for implementation
**Implementer:** Codex
**Verifier:** Claude
**Design Reference:** docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md — Sections 21, 22, 23, 24, 84

---

## 1. Codex Instructions — Read This First

You are implementing Gate-11 of PACE-ERP Operation Management.

**What you are building:**
The inventory foundation — the schema, tables, and seed data that every stock movement in the system depends on. This is append-only ledger architecture. Nothing in this gate does actual business logic — it creates the data structures that the posting engine will use.

**What you must NOT do:**
- Do NOT create any frontend files
- Do NOT create any handler files in this gate — data structures only
- Do NOT modify any existing migrations
- Do NOT touch erp_core, erp_acl, erp_audit, erp_meta schemas
- Do NOT put these tables in the public schema
- Do NOT use `db.from("table")` anywhere — always `db.schema("erp_inventory").from("table")`
- Do NOT add RLS policies that allow anon or authenticated roles — service role only (same pattern as erp_hr schema)
- Do NOT create stock_ledger with UPDATE or DELETE triggers — it is INSERT-only by design

**File header:** Every migration file must start with the standard PACE header (SQL comment style):
```sql
-- ============================================================
-- File-ID: <ID>
-- File-Path: supabase/migrations/<filename>.sql
-- Gate: 11
-- Phase: 11
-- Domain: INVENTORY
-- Purpose: <single sentence>
-- Authority: Backend
-- ============================================================
```

**Migration naming convention:**
`20260509{HHMMSS}_gate11_{id}_{description}.sql`

**Log update:** After completing each item, update `OM-IMPLEMENTATION-LOG.md` — change status from PENDING to DONE and list files created.

---

## 2. Schema to Create

**Schema name:** `erp_inventory`

This is a new schema. It does not exist yet. Create it in the first migration.

Grant pattern — match erp_hr exactly:
```sql
GRANT USAGE ON SCHEMA erp_inventory TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA erp_inventory
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA erp_inventory
  GRANT ALL ON SEQUENCES TO service_role;
```

---

## 3. Migration Files — Exact Sequence

Implement in this exact order. Do not skip or reorder.

---

### Migration 11.1 — Create Schema + Grant
**File:** `20260509100000_gate11_11_1_create_erp_inventory_schema.sql`

```sql
BEGIN;

CREATE SCHEMA IF NOT EXISTS erp_inventory;

GRANT USAGE ON SCHEMA erp_inventory TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_inventory
  GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_inventory
  GRANT ALL ON SEQUENCES TO service_role;

COMMIT;
```

---

### Migration 11.2 — Movement Type Master
**File:** `20260509101000_gate11_11_2_create_movement_type_master.sql`

**Purpose:** Defines every valid stock movement in the system. SA-locked. No movement executes unless it exists here and is active.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.movement_type_master (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The PACE P-prefix code. e.g. P101, P261, P321
  code                        text NOT NULL UNIQUE,
  name                        text NOT NULL,

  -- IN = stock increases, OUT = stock decreases, TRANSFER = both sides change
  direction                   text NOT NULL CHECK (direction IN ('IN', 'OUT', 'TRANSFER')),

  -- Which stock type does this movement read from (source)?
  -- NULL means no source deduction (e.g. opening stock P561)
  source_stock_type           text NULL,

  -- Which stock type does this movement write to (target)?
  -- NULL means stock is consumed/destroyed (e.g. scrap P551)
  target_stock_type           text NULL,

  -- What document must be referenced when this movement is posted?
  -- NULL means no reference required
  reference_document_required boolean NOT NULL DEFAULT false,
  reference_document_type     text NULL,
  -- Valid values: PO, PROCESS_ORDER, PACKING_ORDER, DISPATCH_INSTRUCTION,
  --               PID_DOCUMENT, PLANT_TRANSFER_ORDER, OPENING_STOCK

  -- Which movement type reverses this one? e.g. P102 reverses P101
  reversal_of                 text NULL REFERENCES erp_inventory.movement_type_master(code),
  reversed_by                 text NULL,

  -- If true: only role-restricted users can post this movement
  role_restricted             boolean NOT NULL DEFAULT false,

  -- If true: approval required before posting
  approval_required           boolean NOT NULL DEFAULT false,

  -- If true: this is a PACE custom movement (901-999 range)
  is_custom                   boolean NOT NULL DEFAULT false,

  -- SA can deactivate a movement type to prevent its use
  active                      boolean NOT NULL DEFAULT true,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NULL
);

COMMENT ON TABLE erp_inventory.movement_type_master IS
'Master list of all valid PACE-ERP stock movements. P-prefix. SA-locked. No movement posts without an active record here.';

COMMENT ON COLUMN erp_inventory.movement_type_master.code IS
'PACE P-prefix movement code. e.g. P101, P261, P321. Stored as-is in stock_ledger.';

COMMENT ON COLUMN erp_inventory.movement_type_master.role_restricted IS
'If true, only users with explicit role permission can post this movement. Used for FOR_REPROCESS movements (P901-P906).';

COMMIT;
```

---

### Migration 11.3 — Stock Type Master
**File:** `20260509102000_gate11_11_3_create_stock_type_master.sql`

**Purpose:** Defines all valid stock states. SA can add new types via UI without developer involvement.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.stock_type_master (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  code                        text NOT NULL UNIQUE,
  name                        text NOT NULL,

  -- Can stock in this type be issued to production?
  available_for_issue         boolean NOT NULL DEFAULT false,

  -- Can stock in this type be dispatched to customer?
  available_for_dispatch      boolean NOT NULL DEFAULT false,

  -- Does moving stock OUT of this type require approval?
  requires_approval_to_move   boolean NOT NULL DEFAULT false,

  -- true = built-in PACE type, false = SA-added custom type
  is_system_type              boolean NOT NULL DEFAULT false,

  active                      boolean NOT NULL DEFAULT true,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NULL
);

COMMENT ON TABLE erp_inventory.stock_type_master IS
'All valid stock states. SA-extensible. Phase-1 has 5 active types: UNRESTRICTED, QUALITY_INSPECTION, BLOCKED, IN_TRANSIT, FOR_REPROCESS.';

COMMIT;
```

---

### Migration 11.4 — Seed Movement Types
**File:** `20260509103000_gate11_11_4_seed_movement_types.sql`

**Purpose:** Insert all Phase-1 active movement types (P-prefix complete list from design document Section 84.8).

```sql
BEGIN;

INSERT INTO erp_inventory.movement_type_master
  (code, name, direction, source_stock_type, target_stock_type,
   reference_document_required, reference_document_type,
   reversal_of, reversed_by, role_restricted, approval_required, is_custom, active)
VALUES

-- ── GRN / PROCUREMENT ──────────────────────────────────────────────
('P101', 'GRN Receipt (PO)',              'IN',       NULL,                  'QUALITY_INSPECTION',  true,  'PO',           NULL,  'P102', false, false, false, true),
('P102', 'P101 Reversal',                 'OUT',      'QUALITY_INSPECTION',  NULL,                  true,  'PO',           'P101', NULL,  false, true,  false, true),
('P103', 'GRN to Blocked Stock',          'IN',       NULL,                  'BLOCKED',             true,  'PO',           NULL,  'P104', false, false, false, true),
('P104', 'P103 Reversal',                 'OUT',      'BLOCKED',             NULL,                  true,  'PO',           'P103', NULL,  false, true,  false, true),
('P122', 'Return to Vendor (Unrestricted)','OUT',     'UNRESTRICTED',        NULL,                  true,  'PO',           NULL,  'P123', false, true,  false, true),
('P123', 'P122 Reversal',                 'IN',       NULL,                  'UNRESTRICTED',        true,  'PO',           'P122', NULL,  false, true,  false, true),
('P124', 'Return to Vendor (Blocked)',    'OUT',      'BLOCKED',             NULL,                  true,  'PO',           NULL,  'P125', false, true,  false, true),
('P125', 'P124 Reversal',                 'IN',       NULL,                  'BLOCKED',             true,  'PO',           'P124', NULL,  false, true,  false, true),

-- ── STOCK TYPE TRANSFERS ────────────────────────────────────────────
('P321', 'QA → Unrestricted',             'TRANSFER', 'QUALITY_INSPECTION',  'UNRESTRICTED',        false, NULL,           NULL,  'P322', false, false, false, true),
('P322', 'Unrestricted → QA',             'TRANSFER', 'UNRESTRICTED',        'QUALITY_INSPECTION',  false, NULL,           NULL,  'P321', false, false, false, true),
('P323', 'QA → Blocked',                  'TRANSFER', 'QUALITY_INSPECTION',  'BLOCKED',             false, NULL,           NULL,  'P324', false, true,  false, true),
('P324', 'P323 Reversal',                 'TRANSFER', 'BLOCKED',             'QUALITY_INSPECTION',  false, NULL,           'P323', NULL,  false, true,  false, true),
('P343', 'Blocked → Unrestricted',        'TRANSFER', 'BLOCKED',             'UNRESTRICTED',        false, NULL,           NULL,  'P344', true,  true,  false, true),
('P344', 'Unrestricted → Blocked',        'TRANSFER', 'UNRESTRICTED',        'BLOCKED',             false, NULL,           NULL,  'P343', false, false, false, true),
('P349', 'Blocked → QA',                  'TRANSFER', 'BLOCKED',             'QUALITY_INSPECTION',  false, NULL,           NULL,  'P350', false, false, false, true),
('P350', 'QA → Blocked',                  'TRANSFER', 'QUALITY_INSPECTION',  'BLOCKED',             false, NULL,           NULL,  'P349', false, false, false, true),

-- ── LOCATION TRANSFERS ──────────────────────────────────────────────
('P311', 'Storage Location Transfer',     'TRANSFER', 'UNRESTRICTED',        'UNRESTRICTED',        false, NULL,           NULL,  'P312', false, false, false, true),
('P312', 'P311 Reversal',                 'TRANSFER', 'UNRESTRICTED',        'UNRESTRICTED',        false, NULL,           'P311', NULL,  false, true,  false, true),

-- ── PLANT TRANSFER ──────────────────────────────────────────────────
('P303', 'Plant Transfer Issue (Two-step)','OUT',     'UNRESTRICTED',        'IN_TRANSIT',          true,  'PLANT_TRANSFER_ORDER', NULL, 'P304', false, true,  false, true),
('P304', 'P303 Reversal',                 'TRANSFER', 'IN_TRANSIT',          'UNRESTRICTED',        true,  'PLANT_TRANSFER_ORDER', 'P303', NULL, false, true,  false, true),
('P305', 'Plant Transfer Receipt (Two-step)','IN',    'IN_TRANSIT',          'UNRESTRICTED',        true,  'PLANT_TRANSFER_ORDER', NULL, 'P306', false, false, false, true),
('P306', 'P305 Reversal',                 'OUT',      'UNRESTRICTED',        'IN_TRANSIT',          true,  'PLANT_TRANSFER_ORDER', 'P305', NULL, false, true,  false, true),

-- ── PRODUCTION ──────────────────────────────────────────────────────
('P261', 'GI to Process/Packing Order',  'OUT',      'UNRESTRICTED',        NULL,                  true,  'PROCESS_ORDER',  NULL,  'P262', false, false, false, true),
('P262', 'P261 Reversal',                 'IN',       NULL,                  'UNRESTRICTED',        true,  'PROCESS_ORDER',  'P261', NULL,  false, true,  false, true),

-- ── DISPATCH ────────────────────────────────────────────────────────
('P601', 'GI for Dispatch (Delivery)',    'OUT',      'UNRESTRICTED',        NULL,                  true,  'DISPATCH_INSTRUCTION', NULL, 'P602', false, false, false, true),
('P602', 'P601 Reversal',                 'IN',       NULL,                  'UNRESTRICTED',        true,  'DISPATCH_INSTRUCTION', 'P601', NULL, false, true,  false, true),

-- ── CUSTOMER RETURNS ────────────────────────────────────────────────
('P651', 'Customer Return Receipt',       'IN',       NULL,                  'BLOCKED',             true,  'DISPATCH_INSTRUCTION', NULL, 'P652', false, false, false, true),
('P652', 'P651 Reversal',                 'OUT',      'BLOCKED',             NULL,                  true,  'DISPATCH_INSTRUCTION', 'P651', NULL, false, true,  false, true),
('P653', 'Return → Unrestricted',         'TRANSFER', 'BLOCKED',             'UNRESTRICTED',        false, NULL,           NULL,  'P654', false, true,  false, true),
('P654', 'P653 Reversal',                 'TRANSFER', 'UNRESTRICTED',        'BLOCKED',             false, NULL,           'P653', NULL,  false, true,  false, true),
('P655', 'Return → QA',                   'TRANSFER', 'BLOCKED',             'QUALITY_INSPECTION',  false, NULL,           NULL,  'P656', false, false, false, true),
('P656', 'P655 Reversal',                 'TRANSFER', 'QUALITY_INSPECTION',  'BLOCKED',             false, NULL,           'P655', NULL,  false, true,  false, true),
('P657', 'Return → Blocked (Confirm)',    'TRANSFER', 'BLOCKED',             'BLOCKED',             false, NULL,           NULL,  'P658', false, false, false, true),
('P658', 'P657 Reversal',                 'TRANSFER', 'BLOCKED',             'BLOCKED',             false, NULL,           'P657', NULL,  false, true,  false, true),

-- ── PHYSICAL INVENTORY ──────────────────────────────────────────────
('P561', 'Opening Stock Posting',         'IN',       NULL,                  'UNRESTRICTED',        false, 'OPENING_STOCK', NULL,  'P562', false, true,  false, true),
('P562', 'P561 Reversal',                 'OUT',      'UNRESTRICTED',        NULL,                  false, 'OPENING_STOCK', 'P561', NULL,  false, true,  false, true),
('P701', 'PID Surplus (Count > Book)',    'IN',       NULL,                  'UNRESTRICTED',        true,  'PID_DOCUMENT',  NULL,  NULL,   false, true,  false, true),
('P702', 'PID Deficit (Count < Book)',    'OUT',      'UNRESTRICTED',        NULL,                  true,  'PID_DOCUMENT',  NULL,  NULL,   false, true,  false, true),

-- ── SCRAP ────────────────────────────────────────────────────────────
('P551', 'Scrap from Unrestricted',       'OUT',      'UNRESTRICTED',        NULL,                  false, NULL,           NULL,  'P552', false, true,  false, true),
('P552', 'P551 Reversal',                 'IN',       NULL,                  'UNRESTRICTED',        false, NULL,           'P551', NULL,  false, true,  false, true),
('P553', 'Scrap from QA',                 'OUT',      'QUALITY_INSPECTION',  NULL,                  false, NULL,           NULL,  'P554', false, true,  false, true),
('P554', 'P553 Reversal',                 'IN',       NULL,                  'QUALITY_INSPECTION',  false, NULL,           'P553', NULL,  false, true,  false, true),
('P555', 'Scrap from Blocked',            'OUT',      'BLOCKED',             NULL,                  false, NULL,           NULL,  'P556', false, true,  false, true),
('P556', 'P555 Reversal',                 'IN',       NULL,                  'BLOCKED',             false, NULL,           'P555', NULL,  false, true,  false, true),

-- ── FOR_REPROCESS (role-restricted) ─────────────────────────────────
('P901', 'Unrestricted → FOR_REPROCESS',  'TRANSFER', 'UNRESTRICTED',        'FOR_REPROCESS',       false, NULL,           NULL,  'P902', true,  false, true,  true),
('P902', 'P901 Reversal',                 'TRANSFER', 'FOR_REPROCESS',       'UNRESTRICTED',        false, NULL,           'P901', NULL,  true,  false, true,  true),
('P903', 'Blocked → FOR_REPROCESS',       'TRANSFER', 'BLOCKED',             'FOR_REPROCESS',       false, NULL,           NULL,  'P904', true,  false, true,  true),
('P904', 'P903 Reversal',                 'TRANSFER', 'FOR_REPROCESS',       'BLOCKED',             false, NULL,           'P903', NULL,  true,  false, true,  true),
('P905', 'QA → FOR_REPROCESS',            'TRANSFER', 'QUALITY_INSPECTION',  'FOR_REPROCESS',       false, NULL,           NULL,  'P906', true,  false, true,  true),
('P906', 'P905 Reversal',                 'TRANSFER', 'FOR_REPROCESS',       'QUALITY_INSPECTION',  false, NULL,           'P905', NULL,  true,  false, true,  true)

ON CONFLICT (code) DO NOTHING;

COMMIT;
```

---

### Migration 11.5 — Seed Stock Types
**File:** `20260509104000_gate11_11_5_seed_stock_types.sql`

```sql
BEGIN;

INSERT INTO erp_inventory.stock_type_master
  (code, name, available_for_issue, available_for_dispatch, requires_approval_to_move, is_system_type, active)
VALUES
  ('UNRESTRICTED',        'Unrestricted',         true,  true,  false, true, true),
  ('QUALITY_INSPECTION',  'Quality Inspection',   false, false, false, true, true),
  ('BLOCKED',             'Blocked',              false, false, true,  true, true),
  ('IN_TRANSIT',          'In Transit',           false, false, false, true, true),
  ('FOR_REPROCESS',       'For Reprocess',        false, false, true,  true, true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
```

---

### Migration 11.6 — Storage Location Master
**File:** `20260509105000_gate11_11_6_create_storage_location_master.sql`

**Purpose:** Global list of storage locations. SA creates globally. Plant mapping is in the next table.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.storage_location_master (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- e.g. R001, P001, F001, S001, T001
  code              text NOT NULL UNIQUE,
  name              text NOT NULL,

  -- PHYSICAL = real room/area, LOGICAL = system-only bucket, TRANSIT = in-motion stock
  location_type     text NOT NULL CHECK (location_type IN ('PHYSICAL', 'LOGICAL', 'TRANSIT')),

  -- If true, stock here is always in motion (IN_TRANSIT stock type only)
  is_transit_location boolean NOT NULL DEFAULT false,

  -- Can dispatch GI (P601) originate from this location?
  dispatch_allowed  boolean NOT NULL DEFAULT false,

  -- Does all stock here require QA release before issue?
  qa_hold_flag      boolean NOT NULL DEFAULT false,

  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL
);

COMMENT ON TABLE erp_inventory.storage_location_master IS
'Global storage location registry. SA-owned. Plant mapping via storage_location_plant_map.';

COMMIT;
```

---

### Migration 11.7 — Storage Location Plant Map
**File:** `20260509106000_gate11_11_7_create_storage_location_plant_map.sql`

**Purpose:** Maps a global storage location to a specific company+plant. Defines which stock types are allowed at that location for that plant. Also records the default GRN landing location.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.storage_location_plant_map (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  storage_location_id       uuid NOT NULL
    REFERENCES erp_inventory.storage_location_master(id)
    ON DELETE RESTRICT,

  -- References erp_master.companies
  company_id                uuid NOT NULL,

  -- References erp_master.projects (plant = project in PACE)
  plant_id                  uuid NOT NULL,

  -- Is this location the default landing spot for GRN at this plant?
  is_default_grn_location   boolean NOT NULL DEFAULT false,

  -- Comma-separated or array of allowed stock type codes for this location+plant
  -- e.g. ARRAY['UNRESTRICTED','QUALITY_INSPECTION']
  allowed_stock_types       text[] NOT NULL DEFAULT ARRAY['UNRESTRICTED'],

  active                    boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NULL,

  UNIQUE (storage_location_id, company_id, plant_id)
);

COMMENT ON TABLE erp_inventory.storage_location_plant_map IS
'Maps a global storage location to a company+plant. Defines allowed stock types per location per plant.';

-- Only one default GRN location per company+plant
CREATE UNIQUE INDEX IF NOT EXISTS idx_slpm_one_default_grn
  ON erp_inventory.storage_location_plant_map (company_id, plant_id)
  WHERE is_default_grn_location = true AND active = true;

COMMIT;
```

---

### Migration 11.8 — Location Transfer Rule
**File:** `20260509107000_gate11_11_8_create_location_transfer_rule.sql`

**Purpose:** SA configures whether a source→destination location pair uses one-step or two-step transfer.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.location_transfer_rule (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  source_location_id    uuid NOT NULL
    REFERENCES erp_inventory.storage_location_master(id)
    ON DELETE RESTRICT,

  dest_location_id      uuid NOT NULL
    REFERENCES erp_inventory.storage_location_master(id)
    ON DELETE RESTRICT,

  -- ONE_STEP = P311 (instant), TWO_STEP = P303→P305 (via IN_TRANSIT)
  transfer_type         text NOT NULL CHECK (transfer_type IN ('ONE_STEP', 'TWO_STEP')),

  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NULL,

  UNIQUE (source_location_id, dest_location_id)
);

COMMENT ON TABLE erp_inventory.location_transfer_rule IS
'SA-configured rule: for each source→destination location pair, is transfer one-step or two-step?';

COMMIT;
```

---

### Migration 11.9 — Number Series Master
**File:** `20260509108000_gate11_11_9_create_number_series_master.sql`

**Purpose:** SA configures document number series per company+section+document type. Fully SA-configurable, nothing hardcoded.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.number_series_master (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References erp_master.companies
  company_id                uuid NOT NULL,

  -- Optional: for section-specific series (e.g. Admix vs Powder PO)
  -- References erp_master.projects or a future section master
  section_id                uuid NULL,

  -- What document type does this series generate numbers for?
  -- e.g. PO, GRN, GATE_ENTRY, PROCESS_ORDER, PACKING_ORDER,
  --      DISPATCH_INSTRUCTION, PLANT_TRANSFER, PID, OPENING_STOCK
  document_type             text NOT NULL,

  -- Number format components
  prefix                    text NOT NULL DEFAULT '',
  suffix                    text NULL,
  separator                 text NOT NULL DEFAULT '/',
  -- How many digits in the number part? e.g. 5 → 00001
  number_padding            int NOT NULL DEFAULT 5,

  -- Does the counter reset on financial year change?
  financial_year_reset      boolean NOT NULL DEFAULT true,

  -- Which month does the financial year start? 4 = April, 1 = January
  fy_start_month            int NOT NULL DEFAULT 4
    CHECK (fy_start_month BETWEEN 1 AND 12),

  -- Include FY in the generated number? e.g. AC/RP00001/2026-27
  include_fy_in_number      boolean NOT NULL DEFAULT true,

  active                    boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NULL,

  UNIQUE (company_id, section_id, document_type)
);

COMMENT ON TABLE erp_inventory.number_series_master IS
'SA-configurable document number series. One series per company+section+document_type. Nothing hardcoded.';

COMMIT;
```

---

### Migration 11.10 — Number Series Counter + Generator Function
**File:** `20260509109000_gate11_11_10_create_number_series_counter.sql`

**Purpose:** Tracks the current counter per series per financial year. Provides `generate_doc_number()` function that atomically increments and returns the next document number.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.number_series_counter (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  series_id       uuid NOT NULL
    REFERENCES erp_inventory.number_series_master(id)
    ON DELETE RESTRICT,

  -- e.g. '2026-27' or '2026'
  financial_year  text NOT NULL,

  last_number     int NOT NULL DEFAULT 0,
  last_generated  timestamptz NULL,

  UNIQUE (series_id, financial_year)
);

COMMENT ON TABLE erp_inventory.number_series_counter IS
'Current counter per number series per financial year. Atomically incremented.';

-- ── Generator Function ─────────────────────────────────────────────
-- Returns the next formatted document number for a given series.
-- Atomically increments the counter. Safe for concurrent calls.
CREATE OR REPLACE FUNCTION erp_inventory.generate_doc_number(
  p_company_id    uuid,
  p_section_id    uuid,
  p_document_type text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_series        erp_inventory.number_series_master%ROWTYPE;
  v_fy            text;
  v_fy_start      date;
  v_next_num      int;
  v_num_str       text;
  v_doc_number    text;
  v_today         date := current_date;
BEGIN
  -- 1. Find the active series
  SELECT * INTO v_series
  FROM erp_inventory.number_series_master
  WHERE company_id    = p_company_id
    AND (section_id   = p_section_id OR (section_id IS NULL AND p_section_id IS NULL))
    AND document_type = p_document_type
    AND active        = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NUMBER_SERIES_NOT_FOUND: No active series for company=%, section=%, type=%',
      p_company_id, p_section_id, p_document_type;
  END IF;

  -- 2. Determine current financial year string
  IF v_series.fy_start_month = 4 THEN
    -- April start: FY 2026-27
    IF EXTRACT(MONTH FROM v_today) >= 4 THEN
      v_fy := EXTRACT(YEAR FROM v_today)::text || '-' ||
              (EXTRACT(YEAR FROM v_today) + 1 - 2000)::text;
    ELSE
      v_fy := (EXTRACT(YEAR FROM v_today) - 1)::text || '-' ||
              (EXTRACT(YEAR FROM v_today) - 2000)::text;
    END IF;
  ELSE
    -- January start or other: just the year
    v_fy := EXTRACT(YEAR FROM v_today)::text;
  END IF;

  -- 3. Atomically increment counter (INSERT or UPDATE)
  INSERT INTO erp_inventory.number_series_counter (series_id, financial_year, last_number, last_generated)
  VALUES (v_series.id, v_fy, 1, now())
  ON CONFLICT (series_id, financial_year)
  DO UPDATE SET
    last_number    = erp_inventory.number_series_counter.last_number + 1,
    last_generated = now()
  RETURNING last_number INTO v_next_num;

  -- 4. Format the number with padding
  v_num_str := lpad(v_next_num::text, v_series.number_padding, '0');

  -- 5. Assemble the document number
  -- Pattern: {prefix}{separator}{num_str}{separator}{FY}
  -- e.g. AC/RP00001/2026-27 or GRN-00001
  v_doc_number := '';

  IF v_series.prefix <> '' THEN
    v_doc_number := v_series.prefix || v_series.separator;
  END IF;

  v_doc_number := v_doc_number || v_num_str;

  IF v_series.include_fy_in_number THEN
    v_doc_number := v_doc_number || v_series.separator || v_fy;
  END IF;

  IF v_series.suffix IS NOT NULL AND v_series.suffix <> '' THEN
    v_doc_number := v_doc_number || v_series.separator || v_series.suffix;
  END IF;

  RETURN v_doc_number;
END;
$$;

COMMIT;
```

---

### Migration 11.11 — Stock Document
**File:** `20260509110000_gate11_11_11_create_stock_document.sql`

**Purpose:** Every stock movement creates a stock document. This is the transaction record — header level. Line-level details are in stock_ledger.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.stock_document (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated using number_series
  document_number             text NOT NULL UNIQUE,
  document_date               date NOT NULL DEFAULT current_date,
  posting_date                date NOT NULL DEFAULT current_date,

  -- Movement type code (e.g. P101, P261)
  movement_type_code          text NOT NULL
    REFERENCES erp_inventory.movement_type_master(code)
    ON DELETE RESTRICT,

  -- Scope
  company_id                  uuid NOT NULL,
  plant_id                    uuid NOT NULL,

  -- Locations (NULL if not applicable for the movement type)
  source_location_id          uuid NULL
    REFERENCES erp_inventory.storage_location_master(id),
  target_location_id          uuid NULL
    REFERENCES erp_inventory.storage_location_master(id),

  source_stock_type           text NULL,
  target_stock_type           text NULL,

  -- Material
  material_id                 uuid NOT NULL,

  -- Quantity in base UOM
  quantity                    numeric(20, 6) NOT NULL CHECK (quantity > 0),
  base_uom_code               text NOT NULL,

  -- Value = quantity × valuation_rate
  value                       numeric(20, 4) NOT NULL DEFAULT 0,
  valuation_rate              numeric(20, 6) NOT NULL DEFAULT 0,

  -- Reference document (mandatory for movements that require it)
  reference_document_type     text NULL,
  reference_document_id       uuid NULL,
  reference_document_number   text NULL,

  -- Batch / lot (if batch tracking enabled for material)
  batch_id                    uuid NULL,

  -- Account assignment
  account_assignment_type     text NULL,
  account_assignment_id       uuid NULL,

  -- Audit
  posted_by                   uuid NOT NULL,
  posted_at                   timestamptz NULL,

  -- Approval
  approval_required           boolean NOT NULL DEFAULT false,
  approved_by                 uuid NULL,
  approved_at                 timestamptz NULL,

  -- Status lifecycle
  -- DRAFT → PENDING_APPROVAL → POSTED → REVERSED / CANCELLED
  status                      text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REVERSED', 'CANCELLED')),

  -- If this document was reversed, link to the reversal document
  reversal_document_id        uuid NULL
    REFERENCES erp_inventory.stock_document(id),

  remarks                     text NULL,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL
);

COMMENT ON TABLE erp_inventory.stock_document IS
'Every stock movement creates a stock document. Header level. Line level is stock_ledger.';

COMMENT ON COLUMN erp_inventory.stock_document.status IS
'DRAFT = saved not posted. PENDING_APPROVAL = waiting for approver. POSTED = ledger updated. REVERSED = reversal posted. CANCELLED = voided before posting.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sd_company_plant ON erp_inventory.stock_document (company_id, plant_id);
CREATE INDEX IF NOT EXISTS idx_sd_material ON erp_inventory.stock_document (material_id);
CREATE INDEX IF NOT EXISTS idx_sd_movement_type ON erp_inventory.stock_document (movement_type_code);
CREATE INDEX IF NOT EXISTS idx_sd_status ON erp_inventory.stock_document (status);
CREATE INDEX IF NOT EXISTS idx_sd_ref_doc ON erp_inventory.stock_document (reference_document_type, reference_document_id);
CREATE INDEX IF NOT EXISTS idx_sd_posting_date ON erp_inventory.stock_document (posting_date);

COMMIT;
```

---

### Migration 11.12 — Stock Ledger (Append-Only)
**File:** `20260509111000_gate11_11_12_create_stock_ledger.sql`

**Purpose:** The single source of truth for all stock. APPEND-ONLY. Rows are never updated or deleted after posting. Every query for historical stock starts here.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.stock_ledger (
  -- Sequential ID for ordering (bigserial, not UUID, for correct ordering)
  ledger_seq              bigserial NOT NULL,
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference to the stock document that created this ledger entry
  stock_document_id       uuid NOT NULL
    REFERENCES erp_inventory.stock_document(id)
    ON DELETE RESTRICT,

  posting_date            date NOT NULL,

  -- Stock position
  company_id              uuid NOT NULL,
  plant_id                uuid NOT NULL,
  storage_location_id     uuid NOT NULL
    REFERENCES erp_inventory.storage_location_master(id)
    ON DELETE RESTRICT,
  material_id             uuid NOT NULL,
  batch_id                uuid NULL,
  stock_type_code         text NOT NULL,

  -- Movement
  movement_type_code      text NOT NULL,

  -- IN = stock received, OUT = stock consumed/issued
  direction               text NOT NULL CHECK (direction IN ('IN', 'OUT')),

  -- Always positive (direction field indicates sign)
  quantity                numeric(20, 6) NOT NULL CHECK (quantity > 0),
  base_uom_code           text NOT NULL,

  -- Always positive monetary value
  value                   numeric(20, 4) NOT NULL DEFAULT 0,
  valuation_rate          numeric(20, 6) NOT NULL DEFAULT 0,

  -- Audit — who posted this entry
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL
);

COMMENT ON TABLE erp_inventory.stock_ledger IS
'APPEND-ONLY source of truth for all stock movements. Rows are never updated or deleted. Every stock position is derived from this table.';

COMMENT ON COLUMN erp_inventory.stock_ledger.ledger_seq IS
'Sequential integer for correct ordering of ledger entries. Use this for historical balance calculations, not created_at.';

COMMENT ON COLUMN erp_inventory.stock_ledger.direction IS
'IN = stock added to position. OUT = stock removed from position. Quantity is always positive.';

-- ── Enforce append-only: block UPDATE and DELETE ───────────────────
CREATE OR REPLACE RULE stock_ledger_no_update AS
  ON UPDATE TO erp_inventory.stock_ledger
  DO INSTEAD NOTHING;

CREATE OR REPLACE RULE stock_ledger_no_delete AS
  ON DELETE TO erp_inventory.stock_ledger
  DO INSTEAD NOTHING;

-- ── Indexes ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sl_company_plant_material
  ON erp_inventory.stock_ledger (company_id, plant_id, material_id);

CREATE INDEX IF NOT EXISTS idx_sl_location_stock_type
  ON erp_inventory.stock_ledger (storage_location_id, stock_type_code);

CREATE INDEX IF NOT EXISTS idx_sl_posting_date
  ON erp_inventory.stock_ledger (posting_date);

CREATE INDEX IF NOT EXISTS idx_sl_stock_document
  ON erp_inventory.stock_ledger (stock_document_id);

CREATE INDEX IF NOT EXISTS idx_sl_batch
  ON erp_inventory.stock_ledger (batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sl_seq
  ON erp_inventory.stock_ledger (ledger_seq);

COMMIT;
```

---

### Migration 11.13 — Stock Snapshot
**File:** `20260509112000_gate11_11_13_create_stock_snapshot.sql`

**Purpose:** Fast-read current stock. One row per unique (company, plant, location, material, batch, stock_type) combination. Updated on every posting. Never used for audit — use stock_ledger for that.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS erp_inventory.stock_snapshot (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stock position key (unique combination)
  company_id            uuid NOT NULL,
  plant_id              uuid NOT NULL,
  storage_location_id   uuid NOT NULL
    REFERENCES erp_inventory.storage_location_master(id)
    ON DELETE RESTRICT,
  material_id           uuid NOT NULL,
  batch_id              uuid NULL,
  stock_type_code       text NOT NULL,

  -- Current quantity and value
  quantity              numeric(20, 6) NOT NULL DEFAULT 0,
  base_uom_code         text NOT NULL,
  value                 numeric(20, 4) NOT NULL DEFAULT 0,

  -- Current weighted average rate (recalculated on every IN movement)
  valuation_rate        numeric(20, 6) NOT NULL DEFAULT 0,

  -- Reference to last ledger entry that updated this snapshot
  last_ledger_id        uuid NULL
    REFERENCES erp_inventory.stock_ledger(id),

  last_updated_at       timestamptz NOT NULL DEFAULT now(),

  -- Unique constraint: one row per stock position
  UNIQUE (company_id, plant_id, storage_location_id, material_id, stock_type_code,
          COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

COMMENT ON TABLE erp_inventory.stock_snapshot IS
'Fast-read current stock position. Updated on every posting. Read from here for UI. Audit from stock_ledger. Must reconcile with ledger at all times.';

COMMENT ON COLUMN erp_inventory.stock_snapshot.valuation_rate IS
'Current weighted average valuation rate for this stock position. Recalculated on every IN movement.';

-- ── Indexes ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ss_company_plant_material
  ON erp_inventory.stock_snapshot (company_id, plant_id, material_id);

CREATE INDEX IF NOT EXISTS idx_ss_location_type
  ON erp_inventory.stock_snapshot (storage_location_id, stock_type_code);

CREATE INDEX IF NOT EXISTS idx_ss_material_all_plants
  ON erp_inventory.stock_snapshot (material_id);

COMMIT;
```

---

## 4. Business Rules Codex Must Enforce

These rules are checked at the **posting engine level** (handler, not DB). Migrations create structure; handlers enforce rules. Document here for when handlers are built in Gate-13+.

| Rule | Description |
|---|---|
| No movement without active movement type | Check movement_type_master.active = true before posting |
| No movement without matching source stock | OUT movements: stock_snapshot.quantity >= quantity being posted |
| No direct stock edit | No UPDATE on stock_snapshot.quantity allowed in handlers — only via posting engine |
| stock_ledger is INSERT only | Never UPDATE or DELETE stock_ledger rows |
| stock_snapshot updated atomically | Snapshot update and ledger insert happen in the same transaction |
| Reference document required | If movement_type_master.reference_document_required = true, reference_document_id must be provided |
| Role-restricted movements | If movement_type_master.role_restricted = true, caller must have specific ACL capability |
| Valuation on IN | On every IN movement: recalculate weighted average = (old_value + new_value) / (old_qty + new_qty) |
| Valuation on OUT | OUT movements use current valuation_rate — no change to rate |

---

## 5. What Codex Must NOT Do

- Do NOT implement handlers in this gate — data structures only
- Do NOT add business logic in migrations — only schema and seed data
- Do NOT create any views that join across schemas without explicit instruction
- Do NOT modify erp_master, erp_core, erp_acl, erp_audit schemas
- Do NOT use `serial` — use `bigserial` for ledger_seq, `uuid` for all other IDs
- Do NOT allow DELETE on stock_ledger — the NO DELETE rule is enforced by the migration

---

## 6. Log Update Instructions for Codex

After completing each migration, update `OM-IMPLEMENTATION-LOG.md`:

```
| 11.X | <item name> | DONE | supabase/migrations/<filename>.sql | — | — |
```

After completing ALL Gate-11 migrations, add a summary entry:
```
Gate-11 implementation complete. All 13 migrations created. Awaiting Claude verification.
```

---

## 7. Verification — Claude Will Check

After Codex marks Gate-11 DONE, Claude will verify:

1. All 13 migration files exist with correct headers
2. `erp_inventory` schema created with proper grants
3. `movement_type_master` has all P-prefix codes from design doc Section 84.8
4. `stock_type_master` has exactly 5 Phase-1 types
5. `stock_ledger` has NO UPDATE / DELETE rules
6. `stock_snapshot` has correct UNIQUE constraint
7. `generate_doc_number()` function exists and handles FY correctly
8. All foreign key references are correct
9. All indexes exist
10. Migration file naming follows convention

---

*Spec frozen: 2026-05-09*
*Reference: Section 84 (Foundation Layer Discovery)*
