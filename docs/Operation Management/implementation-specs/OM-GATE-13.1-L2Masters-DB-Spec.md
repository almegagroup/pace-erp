# OM-GATE-13.1 — L2 Masters DB Spec
# PACE-ERP Operation Management — Payment Terms, Port, Transit, Material Category, Lead Times, Transporter, CHA

**Gate:** 13.1
**Phase:** Operation Management — Layer 2
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-12 VERIFIED ✅ — proceed
**Implementer:** Codex
**Verifier:** Claude
**Design Reference:** docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md — Sections 87.4, 89.4–89.8, 94, 95

---

## 1. Codex Instructions — Read This First

**What you are building:**
L2 master tables — all in the existing `erp_master` schema. These masters are prerequisites for Gates 13.2–13.9. No other gate may begin before this gate is VERIFIED.

**What you must NOT do:**
- Do NOT create a new schema — all tables go in `erp_master`
- Do NOT modify any existing erp_master tables except the ALTER in Migration 13.1.8
- Do NOT create frontend files or handlers
- Do NOT use FK constraints that cross schema boundaries

**File header for migrations (SQL style):**
```sql
/*
 * File-ID: 13.1.X
 * File-Path: supabase/migrations/20260511HHMMSS_gate13_1_13_1_X_description.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: One sentence.
 * Authority: Backend
 */
```

**Migration naming:** `20260511{HHMMSS}_gate13_1_13_1_{N}_{description}.sql`

**Log update:** After each item, update `OM-IMPLEMENTATION-LOG.md` — PENDING → DONE.

---

## 2. Migration Files — Exact Sequence

---

### Migration 13.1.1 — Payment Terms Master
**File:** `20260511010000_gate13_1_13_1_1_create_payment_terms_master.sql`

**Purpose:** Structured payment terms master managed by Procurement Manager. Referenced by PO and Customer Master via dynamic last-used pattern.

```sql
/*
 * File-ID: 13.1.1
 * File-Path: supabase/migrations/20260511010000_gate13_1_13_1_1_create_payment_terms_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Payment Terms Master — structured terms referenced by PO, vendor, and customer.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.payment_terms_master (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated: PT-001, PT-002 etc.
  code              text NOT NULL UNIQUE,
  name              text NOT NULL,

  -- CREDIT | ADVANCE | LC | TT | DA | DP | MIXED
  payment_method    text NOT NULL
    CHECK (payment_method IN ('CREDIT', 'ADVANCE', 'LC', 'TT', 'DA', 'DP', 'MIXED')),

  -- INVOICE_DATE | GRN_DATE | BL_DATE | SHIPMENT_DATE | N_A
  reference_date    text NOT NULL DEFAULT 'INVOICE_DATE'
    CHECK (reference_date IN ('INVOICE_DATE', 'GRN_DATE', 'BL_DATE', 'SHIPMENT_DATE', 'N_A')),

  -- For CREDIT / MIXED terms
  credit_days       int NULL CHECK (credit_days >= 0),

  -- For ADVANCE / MIXED terms (0–100)
  advance_pct       numeric(5, 2) NULL CHECK (advance_pct >= 0 AND advance_pct <= 100),

  -- AT_SIGHT | USANCE | N_A
  lc_type           text NOT NULL DEFAULT 'N_A'
    CHECK (lc_type IN ('AT_SIGHT', 'USANCE', 'N_A')),

  -- For USANCE LC
  usance_days       int NULL CHECK (usance_days >= 0),

  description       text NULL,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  last_updated_at   timestamptz NULL,
  last_updated_by   uuid NULL
);

COMMENT ON TABLE erp_master.payment_terms_master IS
'Structured Payment Terms Master. Managed by Procurement Manager (no SA required). Referenced by PO header and Customer Master via dynamic last-used pattern. LC Required auto-derives when payment_method = LC.';

-- Code sequence for PT-001, PT-002...
CREATE TABLE IF NOT EXISTS erp_master.payment_terms_code_sequence (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_number int NOT NULL DEFAULT 0
);
INSERT INTO erp_master.payment_terms_code_sequence (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION erp_master.generate_payment_terms_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.payment_terms_code_sequence
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'PT-' || lpad(v_next::text, 3, '0');
END;
$$;

CREATE INDEX IF NOT EXISTS idx_ptm_code   ON erp_master.payment_terms_master (code);
CREATE INDEX IF NOT EXISTS idx_ptm_method ON erp_master.payment_terms_master (payment_method);
CREATE INDEX IF NOT EXISTS idx_ptm_active ON erp_master.payment_terms_master (active);

GRANT SELECT ON erp_master.payment_terms_master          TO authenticated;
GRANT ALL    ON erp_master.payment_terms_master          TO service_role;
GRANT ALL    ON erp_master.payment_terms_code_sequence   TO service_role;

COMMIT;
```

---

### Migration 13.1.2 — Port Master
**File:** `20260511011000_gate13_1_13_1_2_create_port_master.sql`

**Purpose:** Discharge/loading port master. Referenced by CSN (Import), Lead Time Master Import, Port-to-Plant Transit Master.

```sql
/*
 * File-ID: 13.1.2
 * File-Path: supabase/migrations/20260511011000_gate13_1_13_1_2_create_port_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Port Master — SEA/AIR/LAND ports referenced by CSN import tracking and lead time masters.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.port_master (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated: PORT-0001, PORT-0002 etc.
  port_code       text NOT NULL UNIQUE,
  port_name       text NOT NULL,

  -- SEA | AIR | LAND
  port_type       text NOT NULL
    CHECK (port_type IN ('SEA', 'AIR', 'LAND')),

  state           text NULL,
  country         text NOT NULL DEFAULT 'India',

  -- Default CHA for this port — references erp_master.cha_master(id)
  -- Plain UUID: CHA master created in 13.1.7; no FK to avoid ordering dependency
  default_cha_id  uuid NULL,

  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL
);

COMMENT ON TABLE erp_master.port_master IS
'Port master for SEA/AIR/LAND ports. SA-managed. Referenced by CSN import fields, Lead Time Master Import (port_of_discharge), and Port-to-Plant Transit Master.';

COMMENT ON COLUMN erp_master.port_master.default_cha_id IS
'Optional default CHA for this port. Plain UUID reference to erp_master.cha_master(id) — no FK constraint to avoid circular dependency with CHA master.';

-- Port code sequence
CREATE TABLE IF NOT EXISTS erp_master.port_code_sequence (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_number int NOT NULL DEFAULT 0
);
INSERT INTO erp_master.port_code_sequence (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION erp_master.generate_port_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.port_code_sequence
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'PORT-' || lpad(v_next::text, 4, '0');
END;
$$;

CREATE INDEX IF NOT EXISTS idx_pm_port_code ON erp_master.port_master (port_code);
CREATE INDEX IF NOT EXISTS idx_pm_port_type ON erp_master.port_master (port_type);
CREATE INDEX IF NOT EXISTS idx_pm_active    ON erp_master.port_master (active);

GRANT SELECT ON erp_master.port_master         TO authenticated;
GRANT ALL    ON erp_master.port_master         TO service_role;
GRANT ALL    ON erp_master.port_code_sequence  TO service_role;

COMMIT;
```

---

### Migration 13.1.3 — Port-to-Plant Transit Master
**File:** `20260511012000_gate13_1_13_1_3_create_port_plant_transit_master.sql`

**Purpose:** Transit days from each port to each destination company/plant. Key input for import ETA cascade (BR field).

```sql
/*
 * File-ID: 13.1.3
 * File-Path: supabase/migrations/20260511012000_gate13_1_13_1_3_create_port_plant_transit_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Port-to-Plant transit days per port + destination company combination for import ETA cascade.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.port_plant_transit_master (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK — port_master is in erp_master
  port_id         uuid NOT NULL
    REFERENCES erp_master.port_master(id)
    ON DELETE RESTRICT,

  -- Intra-schema FK — companies is in erp_master
  company_id      uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,

  -- BR — days from port gate-out to plant gate arrival
  transit_days    int NOT NULL CHECK (transit_days >= 0),

  -- ROAD | RAIL | MULTI-MODAL
  mode            text NOT NULL DEFAULT 'ROAD'
    CHECK (mode IN ('ROAD', 'RAIL', 'MULTI-MODAL')),

  remarks         text NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL,

  -- One transit record per port + company combination
  UNIQUE (port_id, company_id)
);

COMMENT ON TABLE erp_master.port_plant_transit_master IS
'Transit days from discharge port to destination company. One record per port + company pair. Same port, same company always has same transit days regardless of material. SA-managed.';

CREATE INDEX IF NOT EXISTS idx_pptm_port    ON erp_master.port_plant_transit_master (port_id);
CREATE INDEX IF NOT EXISTS idx_pptm_company ON erp_master.port_plant_transit_master (company_id);

GRANT SELECT ON erp_master.port_plant_transit_master TO authenticated;
GRANT ALL    ON erp_master.port_plant_transit_master TO service_role;

COMMIT;
```

---

### Migration 13.1.4 — Material Category Master
**File:** `20260511013000_gate13_1_13_1_4_create_material_category_master.sql`

**Purpose:** Procurement planning material category (NOT the same as material_category_group from Gate-12). Used for ETA grouping and lead time lookup. Each material maps to one category.

```sql
/*
 * File-ID: 13.1.4
 * File-Path: supabase/migrations/20260511013000_gate13_1_13_1_4_create_material_category_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Material Category Master for procurement planning grouping and lead time lookup.
 * Authority: Backend
 */

BEGIN;

-- ── Material Category Master ─────────────────────────────────────────────────
-- This is the PROCUREMENT PLANNING category (e.g. "RM - Fibre", "PM - Carton").
-- NOT the same as material_category_group (Gate-12) which groups functional substitutes.
CREATE TABLE IF NOT EXISTS erp_master.material_category_master (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated: MC-0001, MC-0002 etc.
  category_code   text NOT NULL UNIQUE,
  category_name   text NOT NULL,
  description     text NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL
);

COMMENT ON TABLE erp_master.material_category_master IS
'Procurement planning material categories (e.g. RM - Fibre, PM - Carton). Used for ETA grouping and lead time lookup. Separate from material_category_group (functional equivalents / substitution). SA-managed.';

-- ── Material-to-Category Assignment ─────────────────────────────────────────
-- Each material belongs to one procurement planning category.
CREATE TABLE IF NOT EXISTS erp_master.material_category_assignment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  material_id     uuid NOT NULL
    REFERENCES erp_master.material_master(id)
    ON DELETE RESTRICT,

  category_id     uuid NOT NULL
    REFERENCES erp_master.material_category_master(id)
    ON DELETE RESTRICT,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL,

  -- One category per material
  UNIQUE (material_id)
);

COMMENT ON TABLE erp_master.material_category_assignment IS
'Maps each material to its procurement planning category. One-to-one: a material has exactly one planning category.';

-- Category code sequence
CREATE TABLE IF NOT EXISTS erp_master.material_category_code_sequence (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_number int NOT NULL DEFAULT 0
);
INSERT INTO erp_master.material_category_code_sequence (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION erp_master.generate_material_category_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.material_category_code_sequence
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'MC-' || lpad(v_next::text, 4, '0');
END;
$$;

CREATE INDEX IF NOT EXISTS idx_mcm_code     ON erp_master.material_category_master (category_code);
CREATE INDEX IF NOT EXISTS idx_mcm_active   ON erp_master.material_category_master (active);
CREATE INDEX IF NOT EXISTS idx_mca_material ON erp_master.material_category_assignment (material_id);
CREATE INDEX IF NOT EXISTS idx_mca_category ON erp_master.material_category_assignment (category_id);

GRANT SELECT ON erp_master.material_category_master         TO authenticated;
GRANT SELECT ON erp_master.material_category_assignment     TO authenticated;
GRANT ALL    ON erp_master.material_category_master         TO service_role;
GRANT ALL    ON erp_master.material_category_assignment     TO service_role;
GRANT ALL    ON erp_master.material_category_code_sequence  TO service_role;

COMMIT;
```

---

### Migration 13.1.5 — Lead Time Masters (Import + Domestic)
**File:** `20260511014000_gate13_1_13_1_5_create_lead_time_masters.sql`

**Purpose:** Import lead times (Sail Time + Clearance Days) and Domestic lead times (Transit Days) used by the ETA cascade engine.

```sql
/*
 * File-ID: 13.1.5
 * File-Path: supabase/migrations/20260511014000_gate13_1_13_1_5_create_lead_time_masters.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Lead Time Master Import (sail time + clearance) and Domestic (transit days) for ETA cascade.
 * Authority: Backend
 */

BEGIN;

-- ── Import Lead Time Master ──────────────────────────────────────────────────
-- Provides: Sail Time (BV) and Clearance Days (BQ) for import ETA cascade.
-- Lookup key: vendor + material category + port of discharge
CREATE TABLE IF NOT EXISTS erp_master.lead_time_master_import (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  vendor_id               uuid NOT NULL
    REFERENCES erp_master.vendor_master(id)
    ON DELETE RESTRICT,

  material_category_id    uuid NOT NULL
    REFERENCES erp_master.material_category_master(id)
    ON DELETE RESTRICT,

  -- Vendor's dispatch port — free text (may not be in our port master)
  port_of_loading         text NOT NULL,

  -- India destination port — must be in port master
  port_of_discharge_id    uuid NOT NULL
    REFERENCES erp_master.port_master(id)
    ON DELETE RESTRICT,

  -- BV: vessel transit days (loading port to discharge port)
  sail_time_days          int NOT NULL CHECK (sail_time_days >= 0),

  -- BQ: expected customs clearance days at discharge port
  clearance_days          int NOT NULL CHECK (clearance_days >= 0),

  -- Version control
  effective_from          date NOT NULL,
  effective_to            date NULL, -- NULL = currently active

  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL
);

COMMENT ON TABLE erp_master.lead_time_master_import IS
'Import lead times per vendor + material category + port of discharge. Provides Sail Time (BV) and Clearance Days (BQ) for ETA cascade calculation. SA-managed. Use effective_from/to for version control.';

-- ── Domestic Lead Time Master ────────────────────────────────────────────────
-- Provides: Transit Days for domestic ETA cascade.
-- Lookup key: vendor + destination company
CREATE TABLE IF NOT EXISTS erp_master.lead_time_master_domestic (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  vendor_id               uuid NOT NULL
    REFERENCES erp_master.vendor_master(id)
    ON DELETE RESTRICT,

  company_id              uuid NOT NULL
    REFERENCES erp_master.companies(id)
    ON DELETE RESTRICT,

  -- Days from LR Date to plant gate arrival
  transit_days            int NOT NULL CHECK (transit_days >= 0),

  effective_from          date NOT NULL,
  effective_to            date NULL,

  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL
);

COMMENT ON TABLE erp_master.lead_time_master_domestic IS
'Domestic lead times per vendor + destination company. Provides Transit Days for domestic ETA cascade. ETA = LR Date + transit_days (or PO Date + transit_days when LR not yet entered). SA-managed.';

CREATE INDEX IF NOT EXISTS idx_ltmi_vendor_cat  ON erp_master.lead_time_master_import (vendor_id, material_category_id);
CREATE INDEX IF NOT EXISTS idx_ltmi_discharge   ON erp_master.lead_time_master_import (port_of_discharge_id);
CREATE INDEX IF NOT EXISTS idx_ltmi_active      ON erp_master.lead_time_master_import (active);
CREATE INDEX IF NOT EXISTS idx_ltmd_vendor_co   ON erp_master.lead_time_master_domestic (vendor_id, company_id);
CREATE INDEX IF NOT EXISTS idx_ltmd_active      ON erp_master.lead_time_master_domestic (active);

GRANT SELECT ON erp_master.lead_time_master_import    TO authenticated;
GRANT SELECT ON erp_master.lead_time_master_domestic  TO authenticated;
GRANT ALL    ON erp_master.lead_time_master_import    TO service_role;
GRANT ALL    ON erp_master.lead_time_master_domestic  TO service_role;

COMMIT;
```

---

### Migration 13.1.6 — Transporter Master
**File:** `20260511015000_gate13_1_13_1_6_create_transporter_master.sql`

**Purpose:** Single transporter master with INBOUND/OUTBOUND/BOTH direction flag. Application layer filters dropdown by document context.

```sql
/*
 * File-ID: 13.1.6
 * File-Path: supabase/migrations/20260511015000_gate13_1_13_1_6_create_transporter_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Transporter Master with usage_direction flag for context-filtered dropdown on inbound/outbound docs.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.transporter_master (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated: TR-00001, TR-00002 etc.
  transporter_code    text NOT NULL UNIQUE,
  transporter_name    text NOT NULL,

  -- INBOUND: vendor→plant. OUTBOUND: plant→customer/plant. BOTH: appears in both.
  -- Application layer filters: inbound docs show INBOUND+BOTH. Outbound docs show OUTBOUND+BOTH.
  usage_direction     text NOT NULL
    CHECK (usage_direction IN ('INBOUND', 'OUTBOUND', 'BOTH')),

  -- ROAD | RAIL | COURIER | MULTI-MODAL
  mode                text NOT NULL DEFAULT 'ROAD'
    CHECK (mode IN ('ROAD', 'RAIL', 'COURIER', 'MULTI-MODAL')),

  contact_person      text NULL,
  phone               text NULL,
  email               text NULL,
  pan_number          text NULL,
  gst_number          text NULL,
  address             text NULL,

  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL
);

COMMENT ON TABLE erp_master.transporter_master IS
'Single transporter master. usage_direction controls dropdown visibility per context. INBOUND+BOTH shown on CSN/GE. OUTBOUND+BOTH shown on Gate Exit/Dispatch. Free-text entry always allowed at usage point for unregistered transporters.';

-- Transporter code sequence
CREATE TABLE IF NOT EXISTS erp_master.transporter_code_sequence (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_number int NOT NULL DEFAULT 0
);
INSERT INTO erp_master.transporter_code_sequence (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION erp_master.generate_transporter_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.transporter_code_sequence
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'TR-' || lpad(v_next::text, 5, '0');
END;
$$;

CREATE INDEX IF NOT EXISTS idx_tm_code      ON erp_master.transporter_master (transporter_code);
CREATE INDEX IF NOT EXISTS idx_tm_direction ON erp_master.transporter_master (usage_direction);
CREATE INDEX IF NOT EXISTS idx_tm_active    ON erp_master.transporter_master (active);

GRANT SELECT ON erp_master.transporter_master          TO authenticated;
GRANT ALL    ON erp_master.transporter_master          TO service_role;
GRANT ALL    ON erp_master.transporter_code_sequence   TO service_role;

COMMIT;
```

---

### Migration 13.1.7 — CHA Master
**File:** `20260511016000_gate13_1_13_1_7_create_cha_master.sql`

**Purpose:** Clearing and Handling Agent master. Referenced by CSN (Import), Port Master default CHA, and Landed Cost.

```sql
/*
 * File-ID: 13.1.7
 * File-Path: supabase/migrations/20260511016000_gate13_1_13_1_7_create_cha_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: CHA Master and CHA-Port mapping for import clearance agent tracking.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.cha_master (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated: CHA-0001, CHA-0002 etc.
  cha_code            text NOT NULL UNIQUE,
  cha_name            text NOT NULL,

  -- Customs broker license number — mandatory
  cha_license_number  text NOT NULL,

  gst_number          text NULL,
  pan_number          text NULL,
  contact_person      text NULL,
  phone               text NULL,
  email               text NULL,
  address             text NULL,

  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL
);

COMMENT ON TABLE erp_master.cha_master IS
'Clearing and Handling Agent master. Procurement-managed (no SA required). Referenced by CSN import fields, port_master.default_cha_id, and Landed Cost entries.';

-- ── CHA-Port Mapping ─────────────────────────────────────────────────────────
-- Which ports this CHA operates at (reference/filter only — not a hard constraint)
CREATE TABLE IF NOT EXISTS erp_master.cha_port_map (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cha_id      uuid NOT NULL
    REFERENCES erp_master.cha_master(id)
    ON DELETE RESTRICT,
  port_id     uuid NOT NULL
    REFERENCES erp_master.port_master(id)
    ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (cha_id, port_id)
);

COMMENT ON TABLE erp_master.cha_port_map IS
'Maps CHA agents to ports where they operate. Used for reference and dropdown filtering — not a hard constraint. A CSN can use any CHA regardless of this mapping.';

-- CHA code sequence
CREATE TABLE IF NOT EXISTS erp_master.cha_code_sequence (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_number int NOT NULL DEFAULT 0
);
INSERT INTO erp_master.cha_code_sequence (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION erp_master.generate_cha_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.cha_code_sequence
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'CHA-' || lpad(v_next::text, 4, '0');
END;
$$;

CREATE INDEX IF NOT EXISTS idx_cha_code    ON erp_master.cha_master (cha_code);
CREATE INDEX IF NOT EXISTS idx_cha_active  ON erp_master.cha_master (active);
CREATE INDEX IF NOT EXISTS idx_cpm_cha     ON erp_master.cha_port_map (cha_id);
CREATE INDEX IF NOT EXISTS idx_cpm_port    ON erp_master.cha_port_map (port_id);

GRANT SELECT ON erp_master.cha_master         TO authenticated;
GRANT SELECT ON erp_master.cha_port_map       TO authenticated;
GRANT ALL    ON erp_master.cha_master         TO service_role;
GRANT ALL    ON erp_master.cha_port_map       TO service_role;
GRANT ALL    ON erp_master.cha_code_sequence  TO service_role;

COMMIT;
```

---

### Migration 13.1.8 — Extend Vendor Master (Indent Required Flag)
**File:** `20260511017000_gate13_1_13_1_8_extend_vendor_master.sql`

**Purpose:** Add `indent_number_required` sticky flag to vendor_master. Controls whether CSN shows Vendor Indent Number field for all POs with this vendor.

```sql
/*
 * File-ID: 13.1.8
 * File-Path: supabase/migrations/20260511017000_gate13_1_13_1_8_extend_vendor_master.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: Add indent_number_required flag to vendor_master for vendor indent tracking control.
 * Authority: Backend
 */

BEGIN;

ALTER TABLE erp_master.vendor_master
  ADD COLUMN IF NOT EXISTS indent_number_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_master.vendor_master.indent_number_required IS
'Sticky flag. When ON: all new POs with this vendor auto-set indent_required = true, and Vendor Indent Number field is shown on CSN. Set by SA. Overridable per PO by Procurement.';

COMMIT;
```

---

## 3. Business Rules Codex Must Know (For Handler Phase)

| Rule | Enforcement Point |
|---|---|
| payment_terms_master.code is NEVER user-editable | Handler calls `generate_payment_terms_code()` |
| port_master.port_code is NEVER user-editable | Handler calls `generate_port_code()` |
| material_category_master.category_code is NEVER user-editable | Handler calls `generate_material_category_code()` |
| transporter_master.transporter_code is NEVER user-editable | Handler calls `generate_transporter_code()` |
| cha_master.cha_code is NEVER user-editable | Handler calls `generate_cha_code()` |
| Transporter dropdown filter | INBOUND context → WHERE usage_direction IN ('INBOUND','BOTH'). OUTBOUND context → WHERE usage_direction IN ('OUTBOUND','BOTH') |
| Lead time lookup precedence | Use most recent active record where effective_from ≤ today AND (effective_to IS NULL OR effective_to ≥ today) |
| Port-to-Plant transit: material-agnostic | Same port + same company always same transit days regardless of material |

---

## 4. What Codex Must NOT Do

- Do NOT create handlers in this gate
- Do NOT modify any existing erp_master tables except the ALTER in Migration 13.1.8
- Do NOT add a `payment_terms` column to vendor_master — dynamic last-used logic is handler-side
- Do NOT add FK from port_master.default_cha_id to cha_master — plain UUID to avoid circular ordering
- Do NOT create any tables in public schema

---

## 5. Log Update Instructions for Codex

After completing each migration, update `OM-IMPLEMENTATION-LOG.md`:
```
| 13.1.X | <item name> | DONE | supabase/migrations/<filename>.sql | — | — |
```

After completing ALL Gate-13.1 migrations:
```
Gate-13.1 implementation complete. All 8 migrations created. Awaiting Claude verification.
```

---

## 6. Verification — Claude Will Check

1. All 8 migration files exist with correct headers (File-ID: 13.1.X)
2. All tables in `erp_master` schema (not public)
3. `payment_terms_master` has correct payment_method + lc_type CHECK constraints
4. `port_master.default_cha_id` is plain UUID (no FK)
5. `port_plant_transit_master` has UNIQUE(port_id, company_id) and both intra-schema FKs
6. `material_category_master` is separate from `material_category_group` (Gate-12 table)
7. `material_category_assignment` has UNIQUE(material_id) — one category per material
8. `lead_time_master_import` has sail_time_days + clearance_days CHECK >= 0
9. `lead_time_master_domestic` has transit_days CHECK >= 0
10. `transporter_master` has usage_direction CHECK ('INBOUND','OUTBOUND','BOTH')
11. `cha_master` has cha_license_number (mandatory)
12. `cha_port_map` has UNIQUE(cha_id, port_id)
13. `vendor_master.indent_number_required` column added with DEFAULT false
14. All 7 code generator functions are SECURITY DEFINER
15. All tables have GRANT SELECT TO authenticated + GRANT ALL TO service_role

---

*Spec frozen: 2026-05-11*
*Reference: Sections 87.4, 89.4–89.8, 94, 95*
