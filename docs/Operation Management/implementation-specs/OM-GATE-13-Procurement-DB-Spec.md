# OM-GATE-13 — Procurement DB Spec
# PACE-ERP Operation Management — erp_procurement Schema

**Gate:** 13
**Phase:** Operation Management — Layer 2 Procurement
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-12 must be VERIFIED before Gate-13 begins
**Implementer:** Codex
**Verifier:** Claude
**Design Reference:** docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md — Sections 85.1–85.5

---

## 1. Codex Instructions — Read This First

You are implementing **Gate-13** of PACE-ERP Operation Management.

**What you are building:**
The procurement transaction tables — Purchase Order, Gate Entry, and Goods Receipt. These go into a new schema called `erp_procurement`. This gate is DB structures only. No handlers, no frontend.

**Flow this gate supports:**
```
Plan → Purchase Order (PO) → Gate Entry → GRN (Goods Receipt)
```

**What you must NOT do:**
- Do NOT create handlers or Edge Functions
- Do NOT create frontend files
- Do NOT touch erp_inventory, erp_master, erp_core, erp_acl, erp_hr, or public schemas
- Do NOT create FK constraints that cross schema boundaries — use plain UUID references
- Do NOT add business logic in migrations — structure only
- Do NOT use `db.from("table")` — always `db.schema("erp_procurement").from("table")`

**Cross-schema reference rule:**
`erp_procurement` tables reference `erp_master` and `erp_inventory` tables via UUID columns with NO foreign key constraints. Comment the reference, but do not enforce it with FK.

**File header format:**
```sql
/*
 * File-ID: 13.X
 * File-Path: supabase/migrations/20260509HHMMSS_gate13_13_X_description.sql
 * Gate: 13
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: One sentence describing what this migration does.
 * Authority: Backend
 */
```

**Migration naming:**
`20260509{HHMMSS}_gate13_13_{id}_{description}.sql`

**Log update:** After each item, update `OM-IMPLEMENTATION-LOG.md` — PENDING → DONE with files created.

---

## 2. New Schema

**Schema name:** `erp_procurement`

This schema does not exist yet. Create it in the first migration.

Grant pattern — same as erp_inventory and erp_hr:
```sql
GRANT USAGE ON SCHEMA erp_procurement TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA erp_procurement
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA erp_procurement
  GRANT ALL ON SEQUENCES TO service_role;
```

---

## 3. Migration Files — Exact Sequence

| Spec Item | Filename |
|---|---|
| 13.1 | `20260509130000_gate13_13_1_create_erp_procurement_schema.sql` |
| 13.2 | `20260509131000_gate13_13_2_create_purchase_order.sql` |
| 13.3 | `20260509132000_gate13_13_3_create_gate_entry.sql` |
| 13.4 | `20260509133000_gate13_13_4_create_goods_receipt.sql` |
| 13.5 | `20260509134000_gate13_13_5_create_procurement_indexes.sql` |

---

## 4. Migration Definitions — Exact SQL

---

### Migration 13.1 — Create Schema + Grant
**File:** `20260509130000_gate13_13_1_create_erp_procurement_schema.sql`

```sql
/*
 * File-ID: 13.1
 * File-Path: supabase/migrations/20260509130000_gate13_13_1_create_erp_procurement_schema.sql
 * Gate: 13
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Create the erp_procurement schema and grant service_role access.
 * Authority: Backend
 */

BEGIN;

CREATE SCHEMA IF NOT EXISTS erp_procurement;

GRANT USAGE ON SCHEMA erp_procurement TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_procurement
  GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA erp_procurement
  GRANT ALL ON SEQUENCES TO service_role;

COMMIT;
```

---

### Migration 13.2 — Purchase Order (Header + Lines)
**File:** `20260509131000_gate13_13_2_create_purchase_order.sql`

**Business rules this structure supports:**
- One PO per vendor per order (not one PO per item)
- PO must reference an approved vendor (vendor_master.status = ACTIVE) — enforced at handler level
- Each PO line must have an ACTIVE vendor_material_info record — enforced at handler level
- PO document number from number_series_master (document_type = 'PO')
- Delivery tolerance per line (overrides material master setting if set)

```sql
/*
 * File-ID: 13.2
 * File-Path: supabase/migrations/20260509131000_gate13_13_2_create_purchase_order.sql
 * Gate: 13
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Create purchase_order header and purchase_order_line tables.
 * Authority: Backend
 */

BEGIN;

-- ── Purchase Order Header ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.purchase_order (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated via number_series_master (document_type = 'PO')
  po_number                 text NOT NULL UNIQUE,

  po_date                   date NOT NULL DEFAULT current_date,

  -- References erp_master.companies — no FK (cross-schema)
  company_id                uuid NOT NULL,

  -- References erp_master.projects (plant = project) — no FK (cross-schema)
  plant_id                  uuid NOT NULL,

  -- References erp_master.vendor_master — no FK (cross-schema)
  vendor_id                 uuid NOT NULL,

  -- DOMESTIC | IMPORT — copied from vendor at time of PO creation
  vendor_type               text NOT NULL
    CHECK (vendor_type IN ('DOMESTIC', 'IMPORT')),

  -- Currency — copied from vendor at time of PO creation
  currency_code             text NOT NULL DEFAULT 'BDT',

  -- Payment terms — copied from vendor_payment_terms_log (latest) at creation
  -- Editable on PO. Stored here as snapshot, not linked to log table.
  payment_terms_days        int NULL CHECK (payment_terms_days >= 0),
  payment_method            text NULL,
  payment_terms_notes       text NULL,

  -- Expected delivery date (header-level, can be overridden per line)
  expected_delivery_date    date NULL,

  -- Delivery address (defaults to plant address, editable)
  delivery_address          text NULL,

  -- Remarks / special instructions
  remarks                   text NULL,

  -- Internal notes (not sent to vendor)
  internal_notes            text NULL,

  -- Auto-mail PO to vendor on approval?
  auto_mail_on_approval     boolean NOT NULL DEFAULT true,

  -- ── STATUS ─────────────────────────────────────────────────────────
  -- DRAFT: being prepared
  -- PENDING_APPROVAL: submitted for approval
  -- APPROVED: approved, can receive against this PO
  -- PARTIALLY_RECEIVED: at least one GRN posted, not fully received
  -- FULLY_RECEIVED: all lines fully received
  -- CLOSED: manually closed (no more receipts allowed)
  -- CANCELLED: voided before approval
  status                    text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT', 'PENDING_APPROVAL', 'APPROVED',
      'PARTIALLY_RECEIVED', 'FULLY_RECEIVED',
      'CLOSED', 'CANCELLED'
    )),

  -- ── APPROVAL ────────────────────────────────────────────────────────
  approved_by               uuid NULL,
  approved_at               timestamptz NULL,
  rejection_reason          text NULL,

  -- ── AUDIT ───────────────────────────────────────────────────────────
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL,
  last_updated_at           timestamptz NULL,
  last_updated_by           uuid NULL
);

COMMENT ON TABLE erp_procurement.purchase_order IS
'Purchase Order header. One PO per vendor per order. Lines in purchase_order_line. Status: DRAFT → APPROVED → PARTIALLY/FULLY_RECEIVED → CLOSED.';

COMMENT ON COLUMN erp_procurement.purchase_order.payment_terms_days IS
'Snapshot of payment terms at time of PO creation. Sourced from vendor_payment_terms_log (latest record). Editable per PO.';

-- ── Purchase Order Lines ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.purchase_order_line (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  po_id                       uuid NOT NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  -- Line number within the PO (1, 2, 3...)
  line_number                 int NOT NULL CHECK (line_number > 0),

  -- References erp_master.material_master — no FK (cross-schema)
  material_id                 uuid NOT NULL,

  -- Snapshot of material pace_code at time of line creation (for display/search)
  material_pace_code          text NOT NULL,

  -- References erp_master.vendor_material_info — no FK (cross-schema)
  -- MUST be ACTIVE at time of PO line save — enforced at handler level
  vendor_material_info_id     uuid NOT NULL,

  -- Pack description copied from vendor_material_info at creation
  pack_size_description       text NOT NULL,

  -- ── QUANTITY ──────────────────────────────────────────────────────
  -- Ordered in PO UOM
  ordered_qty                 numeric(20, 6) NOT NULL CHECK (ordered_qty > 0),

  -- The UOM used on this PO line (from vendor_material_info.po_uom_code)
  po_uom_code                 text NOT NULL,

  -- Conversion factor at time of PO (from vendor_material_info)
  conversion_factor           numeric(20, 6) NOT NULL CHECK (conversion_factor > 0),

  -- If true: actual conversion entered at GRN time (variable-weight bags)
  variable_conversion         boolean NOT NULL DEFAULT false,

  -- Ordered quantity in base UOM (= ordered_qty × conversion_factor)
  -- Computed at creation. NULL if variable_conversion = true.
  ordered_qty_base_uom        numeric(20, 6) NULL,

  -- Base UOM code (from material_master.base_uom_code)
  base_uom_code               text NOT NULL,

  -- ── QUANTITY RECEIVED ────────────────────────────────────────────
  -- Updated by GRN posting handler
  received_qty_po_uom         numeric(20, 6) NOT NULL DEFAULT 0,
  received_qty_base_uom       numeric(20, 6) NOT NULL DEFAULT 0,

  -- ── PRICING ─────────────────────────────────────────────────────
  -- Unit price in PO currency per PO UOM
  unit_price                  numeric(20, 4) NOT NULL CHECK (unit_price >= 0),
  currency_code               text NOT NULL DEFAULT 'BDT',

  -- Total line value = ordered_qty × unit_price (before taxes)
  line_value                  numeric(20, 4) NOT NULL DEFAULT 0,

  -- Tax / GST (for domestic)
  tax_percent                 numeric(5, 2) NULL CHECK (tax_percent >= 0),
  tax_amount                  numeric(20, 4) NULL,

  -- ── DELIVERY ────────────────────────────────────────────────────
  -- Line-level delivery date (overrides PO header if set)
  expected_delivery_date      date NULL,

  -- Default receiving location for this line at GRN time
  -- References erp_inventory.storage_location_master — no FK (cross-schema)
  -- Overrides material_plant_ext.default_storage_location_id if set
  default_receiving_location_id uuid NULL,

  -- ── DELIVERY TOLERANCE ──────────────────────────────────────────
  -- If NULL: use material_master settings
  -- If set here: override material_master settings for this PO line
  delivery_tolerance_enabled    boolean NULL,
  under_delivery_tolerance_pct  numeric(5, 2) NULL CHECK (under_delivery_tolerance_pct >= 0),
  over_delivery_tolerance_pct   numeric(5, 2) NULL CHECK (over_delivery_tolerance_pct >= 0),

  -- ── LINE STATUS ──────────────────────────────────────────────────
  -- OPEN: not yet fully received
  -- PARTIALLY_RECEIVED: some GRN posted
  -- FULLY_RECEIVED: received qty >= ordered qty (within tolerance)
  -- CLOSED: manually closed
  -- CANCELLED: line voided
  line_status                   text NOT NULL DEFAULT 'OPEN'
    CHECK (line_status IN (
      'OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED', 'CANCELLED'
    )),

  remarks                       text NULL,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  created_by                    uuid NOT NULL,

  -- Each PO can have each line number only once
  UNIQUE (po_id, line_number)
);

COMMENT ON TABLE erp_procurement.purchase_order_line IS
'One row per material line in a Purchase Order. vendor_material_info must be ACTIVE at time of save (enforced by handler, not DB).';

COMMENT ON COLUMN erp_procurement.purchase_order_line.vendor_material_info_id IS
'References erp_master.vendor_material_info. MUST be ACTIVE at PO line save time. Handler checks this — DB does not enforce.';

COMMENT ON COLUMN erp_procurement.purchase_order_line.received_qty_po_uom IS
'Updated by GRN posting handler each time a GRN line is posted against this PO line. Do not update manually.';

COMMIT;
```

---

### Migration 13.3 — Gate Entry (Header + Lines)
**File:** `20260509132000_gate13_13_3_create_gate_entry.sql`

**Business rules this structure supports:**
- Gate Entry is mandatory before GRN can be posted
- Gate Entry records vehicle details, challan details, physical package count
- One Gate Entry can cover multiple POs from the same vendor
- Gate Entry lines link to PO lines
- Gate Entry is closed when all lines are GRN-posted

```sql
/*
 * File-ID: 13.3
 * File-Path: supabase/migrations/20260509132000_gate13_13_3_create_gate_entry.sql
 * Gate: 13
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Create gate_entry header and gate_entry_line tables for inward shipment logging.
 * Authority: Backend
 */

BEGIN;

-- ── Gate Entry Header ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.gate_entry (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated via number_series_master (document_type = 'GATE_ENTRY')
  gate_entry_number         text NOT NULL UNIQUE,

  entry_date                date NOT NULL DEFAULT current_date,
  entry_time                timetz NOT NULL DEFAULT current_time,

  -- References erp_master.companies — no FK (cross-schema)
  company_id                uuid NOT NULL,

  -- References erp_master.projects (plant = project) — no FK (cross-schema)
  plant_id                  uuid NOT NULL,

  -- References erp_master.vendor_master — no FK (cross-schema)
  vendor_id                 uuid NOT NULL,

  -- ── VEHICLE DETAILS ──────────────────────────────────────────────
  vehicle_number            text NULL,
  vehicle_type              text NULL,
  driver_name               text NULL,
  driver_phone              text NULL,

  -- ── CHALLAN / DOCUMENT DETAILS ───────────────────────────────────
  -- Vendor's delivery challan number
  vendor_challan_number     text NULL,
  vendor_challan_date       date NULL,

  -- Vendor's invoice number (if sent along with delivery)
  vendor_invoice_number     text NULL,
  vendor_invoice_date       date NULL,

  -- ── PHYSICAL CHECK AT GATE ───────────────────────────────────────
  -- Total packages arrived (outer count at gate)
  total_packages_received   int NULL CHECK (total_packages_received >= 0),

  -- Any visible damage at gate?
  damage_noted              boolean NOT NULL DEFAULT false,
  damage_description        text NULL,

  -- Security seal intact?
  seal_intact               boolean NULL,
  seal_number               text NULL,

  remarks                   text NULL,

  -- ── STATUS ───────────────────────────────────────────────────────
  -- OPEN: gate entry created, GRN pending
  -- PARTIALLY_GRN: some lines GRN-posted
  -- FULLY_GRN: all lines GRN-posted
  -- CLOSED: manually closed without full GRN (short shipment accepted)
  status                    text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'PARTIALLY_GRN', 'FULLY_GRN', 'CLOSED')),

  -- ── AUDIT ────────────────────────────────────────────────────────
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL,
  last_updated_at           timestamptz NULL,
  last_updated_by           uuid NULL
);

COMMENT ON TABLE erp_procurement.gate_entry IS
'Inbound shipment log at the factory gate. Must be created before GRN can be posted. One gate entry can cover multiple PO lines from the same vendor.';

-- ── Gate Entry Lines ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.gate_entry_line (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  gate_entry_id             uuid NOT NULL
    REFERENCES erp_procurement.gate_entry(id)
    ON DELETE RESTRICT,

  line_number               int NOT NULL CHECK (line_number > 0),

  -- References erp_procurement.purchase_order_line — intra-schema FK allowed
  po_line_id                uuid NOT NULL
    REFERENCES erp_procurement.purchase_order_line(id)
    ON DELETE RESTRICT,

  -- References erp_procurement.purchase_order — denormalized for fast access
  po_id                     uuid NOT NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  -- References erp_master.material_master — no FK (cross-schema)
  material_id               uuid NOT NULL,

  -- Snapshot for display
  material_pace_code        text NOT NULL,

  -- ── QUANTITY AT GATE ─────────────────────────────────────────────
  -- What physically arrived at gate (in PO UOM)
  received_qty_po_uom       numeric(20, 6) NOT NULL CHECK (received_qty_po_uom >= 0),
  po_uom_code               text NOT NULL,

  -- Package count for this line
  package_count             int NULL CHECK (package_count >= 0),

  -- Physical condition
  condition_ok              boolean NOT NULL DEFAULT true,
  condition_notes           text NULL,

  -- ── GRN STATUS ───────────────────────────────────────────────────
  -- Has GRN been posted for this gate entry line?
  grn_posted                boolean NOT NULL DEFAULT false,

  -- References erp_procurement.goods_receipt_line — no FK yet (table created in 13.4)
  -- Set when GRN is posted for this line
  grn_line_id               uuid NULL,

  remarks                   text NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL,

  UNIQUE (gate_entry_id, line_number)
);

COMMENT ON TABLE erp_procurement.gate_entry_line IS
'One row per material item in a gate entry. Links to PO line. grn_posted=true when GRN handler posts stock for this line.';

COMMENT ON COLUMN erp_procurement.gate_entry_line.grn_line_id IS
'Set by GRN posting handler. References goods_receipt_line. No FK constraint — set after GRN table is created.';

COMMIT;
```

---

### Migration 13.4 — Goods Receipt (Header + Lines)
**File:** `20260509133000_gate13_13_4_create_goods_receipt.sql`

**Business rules this structure supports:**
- GRN must reference a Gate Entry (no GRN without gate entry)
- GRN posts actual stock — triggers stock_document + stock_ledger + stock_snapshot
- Movement type on GRN: P101 (to QA) or P103 (to Blocked) — set by handler based on material QA setting
- GRN posting updates vendor_material_info.last_purchase_price
- If variable_conversion = true on PO line, actual conversion factor entered at GRN line
- Batch number entered at GRN time (if batch_tracking_required on material)

```sql
/*
 * File-ID: 13.4
 * File-Path: supabase/migrations/20260509133000_gate13_13_4_create_goods_receipt.sql
 * Gate: 13
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Create goods_receipt header and goods_receipt_line tables for stock inward posting.
 * Authority: Backend
 */

BEGIN;

-- ── Goods Receipt Header ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.goods_receipt (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated via number_series_master (document_type = 'GRN')
  grn_number                text NOT NULL UNIQUE,

  grn_date                  date NOT NULL DEFAULT current_date,
  posting_date              date NOT NULL DEFAULT current_date,

  -- References erp_master.companies — no FK (cross-schema)
  company_id                uuid NOT NULL,

  -- References erp_master.projects (plant) — no FK (cross-schema)
  plant_id                  uuid NOT NULL,

  -- References erp_master.vendor_master — no FK (cross-schema)
  vendor_id                 uuid NOT NULL,

  -- The gate entry this GRN is against (mandatory)
  gate_entry_id             uuid NOT NULL
    REFERENCES erp_procurement.gate_entry(id)
    ON DELETE RESTRICT,

  -- The PO this GRN is against
  -- One GRN covers one PO (even if gate entry had multiple POs)
  po_id                     uuid NOT NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  -- Vendor documents (for reconciliation)
  vendor_challan_number     text NULL,
  vendor_invoice_number     text NULL,

  remarks                   text NULL,

  -- ── STATUS ───────────────────────────────────────────────────────
  -- DRAFT: being prepared (stock NOT yet posted)
  -- POSTED: stock posted to ledger and snapshot (IRREVERSIBLE without reversal GRN)
  -- REVERSED: a reversal GRN has been posted (P102/P104)
  -- CANCELLED: voided before posting
  status                    text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED', 'CANCELLED')),

  -- When POSTED: links to the stock_document created
  -- References erp_inventory.stock_document — no FK (cross-schema)
  stock_document_id         uuid NULL,

  -- When REVERSED: links to the reversal GRN
  reversal_grn_id           uuid NULL
    REFERENCES erp_procurement.goods_receipt(id),

  -- ── AUDIT ────────────────────────────────────────────────────────
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL,
  posted_at                 timestamptz NULL,
  posted_by                 uuid NULL
);

COMMENT ON TABLE erp_procurement.goods_receipt IS
'GRN header. Must reference a Gate Entry. Posting triggers stock_document + stock_ledger INSERT + stock_snapshot UPDATE. Once POSTED, can only be undone by a reversal GRN.';

COMMENT ON COLUMN erp_procurement.goods_receipt.stock_document_id IS
'Set by GRN posting handler. References erp_inventory.stock_document created during posting. No FK — cross-schema.';

COMMENT ON COLUMN erp_procurement.goods_receipt.status IS
'DRAFT = stock not posted. POSTED = stock in ledger, cannot be edited. REVERSED = reversal done. CANCELLED = voided pre-posting.';

-- ── Goods Receipt Lines ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.goods_receipt_line (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  grn_id                      uuid NOT NULL
    REFERENCES erp_procurement.goods_receipt(id)
    ON DELETE RESTRICT,

  line_number                 int NOT NULL CHECK (line_number > 0),

  -- The gate entry line this GRN line is posting against
  gate_entry_line_id          uuid NOT NULL
    REFERENCES erp_procurement.gate_entry_line(id)
    ON DELETE RESTRICT,

  -- The PO line being received
  po_line_id                  uuid NOT NULL
    REFERENCES erp_procurement.purchase_order_line(id)
    ON DELETE RESTRICT,

  -- References erp_master.material_master — no FK (cross-schema)
  material_id                 uuid NOT NULL,
  material_pace_code          text NOT NULL,

  -- ── QUANTITY RECEIVED ──────────────────────────────────────────
  -- Actual received quantity in PO UOM
  received_qty_po_uom         numeric(20, 6) NOT NULL CHECK (received_qty_po_uom > 0),
  po_uom_code                 text NOT NULL,

  -- Conversion factor to base UOM
  -- If variable_conversion=true on PO line: entered here at GRN time
  -- If variable_conversion=false: copied from PO line (vendor_material_info)
  conversion_factor           numeric(20, 6) NOT NULL CHECK (conversion_factor > 0),

  -- Actual quantity in base UOM (= received_qty_po_uom × conversion_factor)
  received_qty_base_uom       numeric(20, 6) NOT NULL CHECK (received_qty_base_uom > 0),
  base_uom_code               text NOT NULL,

  -- ── BATCH / LOT ───────────────────────────────────────────────
  -- Required if material.batch_tracking_required = true
  -- References erp_inventory.batch_master (future gate) — store as text for now
  batch_number                text NULL,

  -- Expiry date — required if material.expiry_tracking_enabled = true
  expiry_date                 date NULL,

  -- Manufacturing date
  manufacturing_date          date NULL,

  -- ── RECEIVING LOCATION ────────────────────────────────────────
  -- Where this material is being received into
  -- Overrides PO line default_receiving_location_id if set
  -- References erp_inventory.storage_location_master — no FK (cross-schema)
  receiving_location_id       uuid NOT NULL,

  -- ── TARGET STOCK TYPE ────────────────────────────────────────
  -- P101 → QUALITY_INSPECTION (default if qa_required_on_inward = true)
  -- P103 → BLOCKED (if received damaged / non-conforming)
  -- Set by handler based on material QA setting, overrideable
  target_stock_type           text NOT NULL DEFAULT 'QUALITY_INSPECTION'
    CHECK (target_stock_type IN ('QUALITY_INSPECTION', 'BLOCKED')),

  -- Movement type used for this line's stock posting
  -- P101 or P103 — set by handler
  movement_type_code          text NOT NULL
    CHECK (movement_type_code IN ('P101', 'P103')),

  -- ── VALUATION ────────────────────────────────────────────────
  -- Unit price per PO UOM (copied from PO line)
  unit_price                  numeric(20, 4) NOT NULL DEFAULT 0,

  -- Valuation rate per BASE UOM (= unit_price / conversion_factor)
  -- Used for stock_ledger valuation
  valuation_rate_base_uom     numeric(20, 6) NOT NULL DEFAULT 0,

  -- Total line value (= received_qty_base_uom × valuation_rate_base_uom)
  line_value                  numeric(20, 4) NOT NULL DEFAULT 0,

  -- ── POST-POSTING LINK ────────────────────────────────────────
  -- References erp_inventory.stock_ledger entry created for this line
  -- Set by GRN posting handler — no FK (cross-schema)
  stock_ledger_id             uuid NULL,

  remarks                     text NULL,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL,

  UNIQUE (grn_id, line_number)
);

COMMENT ON TABLE erp_procurement.goods_receipt_line IS
'One row per material in a GRN. On posting, handler creates stock_document + stock_ledger entry + updates stock_snapshot and vendor_material_info.last_purchase_price.';

COMMENT ON COLUMN erp_procurement.goods_receipt_line.conversion_factor IS
'For variable_conversion=true materials: entered by user at GRN time. For fixed conversion: copied from vendor_material_info. Always stored here as snapshot.';

COMMENT ON COLUMN erp_procurement.goods_receipt_line.target_stock_type IS
'QUALITY_INSPECTION: default for QA-required materials (movement P101). BLOCKED: for damaged/non-conforming receipts (movement P103).';

COMMIT;
```

---

### Migration 13.5 — Indexes
**File:** `20260509134000_gate13_13_5_create_procurement_indexes.sql`

```sql
/*
 * File-ID: 13.5
 * File-Path: supabase/migrations/20260509134000_gate13_13_5_create_procurement_indexes.sql
 * Gate: 13
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Create all indexes for erp_procurement tables.
 * Authority: Backend
 */

BEGIN;

-- ── purchase_order indexes ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_po_company_plant
  ON erp_procurement.purchase_order (company_id, plant_id);

CREATE INDEX IF NOT EXISTS idx_po_vendor
  ON erp_procurement.purchase_order (vendor_id);

CREATE INDEX IF NOT EXISTS idx_po_status
  ON erp_procurement.purchase_order (status);

CREATE INDEX IF NOT EXISTS idx_po_date
  ON erp_procurement.purchase_order (po_date);

CREATE INDEX IF NOT EXISTS idx_po_number
  ON erp_procurement.purchase_order (po_number);

-- ── purchase_order_line indexes ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pol_po
  ON erp_procurement.purchase_order_line (po_id);

CREATE INDEX IF NOT EXISTS idx_pol_material
  ON erp_procurement.purchase_order_line (material_id);

CREATE INDEX IF NOT EXISTS idx_pol_vmi
  ON erp_procurement.purchase_order_line (vendor_material_info_id);

CREATE INDEX IF NOT EXISTS idx_pol_status
  ON erp_procurement.purchase_order_line (line_status);

-- ── gate_entry indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ge_company_plant
  ON erp_procurement.gate_entry (company_id, plant_id);

CREATE INDEX IF NOT EXISTS idx_ge_vendor
  ON erp_procurement.gate_entry (vendor_id);

CREATE INDEX IF NOT EXISTS idx_ge_status
  ON erp_procurement.gate_entry (status);

CREATE INDEX IF NOT EXISTS idx_ge_date
  ON erp_procurement.gate_entry (entry_date);

-- ── gate_entry_line indexes ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_gel_gate_entry
  ON erp_procurement.gate_entry_line (gate_entry_id);

CREATE INDEX IF NOT EXISTS idx_gel_po_line
  ON erp_procurement.gate_entry_line (po_line_id);

CREATE INDEX IF NOT EXISTS idx_gel_material
  ON erp_procurement.gate_entry_line (material_id);

CREATE INDEX IF NOT EXISTS idx_gel_grn_posted
  ON erp_procurement.gate_entry_line (grn_posted)
  WHERE grn_posted = false;

-- ── goods_receipt indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_grn_company_plant
  ON erp_procurement.goods_receipt (company_id, plant_id);

CREATE INDEX IF NOT EXISTS idx_grn_vendor
  ON erp_procurement.goods_receipt (vendor_id);

CREATE INDEX IF NOT EXISTS idx_grn_status
  ON erp_procurement.goods_receipt (status);

CREATE INDEX IF NOT EXISTS idx_grn_gate_entry
  ON erp_procurement.goods_receipt (gate_entry_id);

CREATE INDEX IF NOT EXISTS idx_grn_po
  ON erp_procurement.goods_receipt (po_id);

CREATE INDEX IF NOT EXISTS idx_grn_date
  ON erp_procurement.goods_receipt (grn_date);

-- ── goods_receipt_line indexes ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_grnl_grn
  ON erp_procurement.goods_receipt_line (grn_id);

CREATE INDEX IF NOT EXISTS idx_grnl_po_line
  ON erp_procurement.goods_receipt_line (po_line_id);

CREATE INDEX IF NOT EXISTS idx_grnl_material
  ON erp_procurement.goods_receipt_line (material_id);

CREATE INDEX IF NOT EXISTS idx_grnl_batch
  ON erp_procurement.goods_receipt_line (batch_number)
  WHERE batch_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grnl_location
  ON erp_procurement.goods_receipt_line (receiving_location_id);

COMMIT;
```

---

## 5. Business Rules — Handler Level (Not DB)

These rules are enforced by Gate-14 handlers, not by migrations. Documented here for when handlers are built.

| Rule | Where Enforced | Detail |
|---|---|---|
| vendor_material_info must be ACTIVE | PO create handler | Query erp_master.vendor_material_info — status must be ACTIVE. Error: VENDOR_NOT_APPROVED_FOR_MATERIAL |
| vendor must be ACTIVE | PO create handler | Query erp_master.vendor_master — status must be ACTIVE. Error: VENDOR_INACTIVE |
| material must be ACTIVE at this plant | PO create handler | Query erp_master.material_plant_ext — status must be ACTIVE |
| PO must be APPROVED before GRN | GRN create handler | purchase_order.status must be APPROVED or PARTIALLY_RECEIVED |
| Gate Entry must be OPEN before GRN | GRN create handler | gate_entry.status must be OPEN or PARTIALLY_GRN |
| GRN qty cannot exceed PO line qty + over-delivery tolerance | GRN create handler | Check (ordered_qty - received_qty) vs tolerance |
| GRN posting updates stock | GRN post handler | INSERT into stock_document, INSERT into stock_ledger, UPSERT stock_snapshot — in single transaction |
| GRN posting updates last_purchase_price | GRN post handler | UPDATE erp_master.vendor_material_info SET last_purchase_price, last_grn_date |
| GRN posting updates PO line received_qty | GRN post handler | UPDATE purchase_order_line SET received_qty_po_uom, received_qty_base_uom |
| PO status auto-updates after GRN | GRN post handler | If all lines FULLY_RECEIVED → PO status = FULLY_RECEIVED |
| Gate Entry line grn_posted flag | GRN post handler | UPDATE gate_entry_line SET grn_posted = true, grn_line_id = new line id |
| Document number generation | PO/GE/GRN create handler | Call erp_inventory.generate_doc_number() with correct document_type |
| Movement type selection | GRN post handler | P101 if target_stock_type = QUALITY_INSPECTION, P103 if BLOCKED |
| valuation_rate_base_uom calculation | GRN create handler | unit_price / conversion_factor |

---

## 6. Document Type Codes for number_series_master

When SA sets up number series (Gate-13 is DB only — SA configures via UI later), use these exact `document_type` values:

| Document | document_type value |
|---|---|
| Purchase Order | `PO` |
| Gate Entry | `GATE_ENTRY` |
| Goods Receipt | `GRN` |

---

## 7. Self-Check Before Marking Done

```
[ ] Migration 13.1: erp_procurement schema created + 3 GRANT statements
[ ] Migration 13.2: purchase_order with all columns, status CHECK, UNIQUE po_number
[ ] Migration 13.2: purchase_order_line with UNIQUE(po_id, line_number), all quantity columns
[ ] Migration 13.2: purchase_order_line.ordered_qty_base_uom is nullable (NULL for variable_conversion)
[ ] Migration 13.3: gate_entry with all vehicle + document columns, status CHECK
[ ] Migration 13.3: gate_entry_line with UNIQUE(gate_entry_id, line_number)
[ ] Migration 13.3: gate_entry_line has intra-schema FKs to purchase_order and purchase_order_line
[ ] Migration 13.4: goods_receipt with gate_entry_id FK (intra-schema), po_id FK (intra-schema)
[ ] Migration 13.4: goods_receipt_line with target_stock_type CHECK ('QUALITY_INSPECTION', 'BLOCKED')
[ ] Migration 13.4: goods_receipt_line with movement_type_code CHECK ('P101', 'P103')
[ ] Migration 13.4: goods_receipt_line.conversion_factor NOT NULL (actual value at GRN time)
[ ] Migration 13.5: All indexes created for all 4 main tables + line tables
[ ] NO cross-schema FK constraints anywhere (company_id, plant_id, vendor_id, material_id all plain uuid)
[ ] stock_document_id, stock_ledger_id — plain uuid NULL, no FK
[ ] All files: Gate: 13, Phase: 13, Domain: PROCUREMENT header
[ ] No tables in public schema
[ ] No existing tables modified
```

---

## 8. Log Update Instructions for Codex

After each migration, update `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`:

```
| 13.X | <item name> | DONE | supabase/migrations/<filename>.sql | — | — |
```

After all 5 migrations:
```
Gate-13 implementation complete. All 5 migrations created. Awaiting Claude verification.
```

---

## 9. Hard Stop — Do NOT Build Handlers Yet

Gate-14 will be the procurement handlers (Edge Functions). Do not build any handlers in this gate.

Gate-14 spec will be provided after Claude verifies Gate-13.

---

*Spec frozen: 2026-05-09*
*Reference: Sections 85.1–85.5 (Layer 2 Procurement Discovery)*
*Dependency: Gate-11 VERIFIED ✅, Gate-12 VERIFIED ✅*
