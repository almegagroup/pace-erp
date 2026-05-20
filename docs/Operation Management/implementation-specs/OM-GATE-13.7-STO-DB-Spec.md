# OM-GATE-13.7 — STO DB Spec
# PACE-ERP Operation Management — erp_procurement

**Gate:** 13.7
**Phase:** Operation Management — Layer 2
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-13.3 VERIFIED ✅ (can run parallel with 13.6)
**Design Reference:** Section 92

---

## 1. What You Are Building

Stock Transfer Order (STO) — two types: CONSIGNMENT_DISTRIBUTION / INTER_PLANT.  
Delivery Challan — auto-generated on stock issue (shared by STO and Sales dispatch).  
Gate Exit Outbound — sending company truck exit document.

---

## 2. Migration Files

---

### Migration 13.7.1 — Stock Transfer Order
**File:** `20260511070000_gate13_7_13_7_1_create_stock_transfer_order.sql`

```sql
/*
 * File-ID: 13.7.1
 * File-Path: supabase/migrations/20260511070000_gate13_7_13_7_1_create_stock_transfer_order.sql
 * Gate: 13.7
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: STO header + lines — CONSIGNMENT_DISTRIBUTION and INTER_PLANT types, same workflow.
 * Authority: Backend
 */

BEGIN;

-- ── STO Header ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.stock_transfer_order (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (STO series)
  sto_number            text NOT NULL UNIQUE,

  sto_date              date NOT NULL,
  system_created_at     timestamptz NOT NULL DEFAULT now(),

  -- CONSIGNMENT_DISTRIBUTION: Sub CSN → STO transform
  -- INTER_PLANT: independent inter-company transfer
  sto_type              text NOT NULL
    CHECK (sto_type IN ('CONSIGNMENT_DISTRIBUTION', 'INTER_PLANT')),

  -- Cross-schema — plain uuid, NO FK
  sending_company_id    uuid NOT NULL,    -- → erp_master.companies
  receiving_company_id  uuid NOT NULL,    -- → erp_master.companies

  -- CSN link — intra-schema FK (for CONSIGNMENT_DISTRIBUTION only)
  related_csn_id        uuid NULL
    REFERENCES erp_procurement.consignment_note(id)
    ON DELETE RESTRICT,

  -- CREATED → DISPATCHED → RECEIVED → CLOSED
  status                text NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED', 'DISPATCHED', 'RECEIVED', 'CLOSED', 'CANCELLED')),

  cancellation_reason   text NULL,
  cancelled_at          timestamptz NULL,
  cancelled_by          uuid NULL,

  remarks               text NULL,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_updated_at       timestamptz NULL,
  last_updated_by       uuid NULL
);

COMMENT ON TABLE erp_procurement.stock_transfer_order IS
'STO header. Both types (CONSIGNMENT_DISTRIBUTION and INTER_PLANT) use the same document structure and workflow. Transfer price is dynamic last-used per material + sending + receiving company pair.';

-- ── STO Lines ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.stock_transfer_order_line (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  sto_id                      uuid NOT NULL
    REFERENCES erp_procurement.stock_transfer_order(id)
    ON DELETE RESTRICT,

  line_number                 int NOT NULL,

  -- Cross-schema — plain uuid, NO FK
  material_id                 uuid NOT NULL,
  -- Sending storage location — cross-schema to erp_inventory
  sending_storage_location_id uuid NULL,    -- → erp_inventory.storage_location_master
  -- Default receiving location from Material Master — overridable at GRN
  receiving_storage_location_id uuid NULL,  -- → erp_inventory.storage_location_master

  quantity                    numeric(20, 6) NOT NULL CHECK (quantity > 0),
  uom_code                    text NOT NULL,

  -- Dynamic last-used transfer price (same pattern as payment terms)
  transfer_price              numeric(20, 4) NULL CHECK (transfer_price >= 0),
  transfer_price_currency     text NOT NULL DEFAULT 'BDT',

  -- Auto-updated by dispatch + receipt handlers
  dispatched_qty              numeric(20, 6) NOT NULL DEFAULT 0,
  received_qty                numeric(20, 6) NOT NULL DEFAULT 0,
  -- Balance = quantity − received_qty
  balance_qty                 numeric(20, 6) NOT NULL,

  -- OPEN → RECEIVED | KNOCKED_OFF
  line_status                 text NOT NULL DEFAULT 'OPEN'
    CHECK (line_status IN ('OPEN', 'RECEIVED', 'KNOCKED_OFF')),

  knock_off_reason            text NULL,
  knocked_off_by              uuid NULL,
  knocked_off_at              timestamptz NULL,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  last_updated_at             timestamptz NULL,

  UNIQUE (sto_id, line_number)
);

COMMENT ON TABLE erp_procurement.stock_transfer_order_line IS
'STO line. transfer_price defaults to last used for this material + sending + receiving company combination. Editable until Delivery Challan is generated.';

COMMIT;
```

---

### Migration 13.7.2 — Delivery Challan
**File:** `20260511071000_gate13_7_13_7_2_create_delivery_challan.sql`

```sql
/*
 * File-ID: 13.7.2
 * File-Path: supabase/migrations/20260511071000_gate13_7_13_7_2_create_delivery_challan.sql
 * Gate: 13.7
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Delivery Challan — auto-generated on stock issue for STO or Sales dispatch. Cannot be manually created.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.delivery_challan (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (DC series)
  dc_number               text NOT NULL UNIQUE,

  dc_date                 date NOT NULL,
  system_created_at       timestamptz NOT NULL DEFAULT now(),

  -- STO or SALES
  dc_type                 text NOT NULL
    CHECK (dc_type IN ('STO', 'SALES')),

  -- Cross-schema — plain uuid, NO FK
  selling_company_id      uuid NOT NULL,
  receiving_company_id    uuid NULL,    -- NULL for external customer sales
  -- External customer reference (for SALES type)
  customer_id             uuid NULL,    -- → erp_master.customer_master (cross-schema)

  -- Intra-schema FK (for STO type)
  sto_id                  uuid NULL
    REFERENCES erp_procurement.stock_transfer_order(id)
    ON DELETE RESTRICT,

  -- For SALES type — intra-schema FK to sales_order (created in Gate-13.9)
  -- Plain uuid to avoid ordering dependency
  sales_order_id          uuid NULL,   -- → erp_procurement.sales_order

  delivery_address        text NULL,

  -- Transport info (filled by Gate Exit handler)
  transporter_id          uuid NULL,   -- → erp_master.transporter_master (cross-schema plain uuid)
  transporter_name_freetext text NULL,
  vehicle_number          text NULL,
  lr_number               text NULL,
  driver_name             text NULL,

  -- AUTO_GENERATED → DISPATCHED
  status                  text NOT NULL DEFAULT 'AUTO_GENERATED'
    CHECK (status IN ('AUTO_GENERATED', 'DISPATCHED')),

  total_value             numeric(20, 4) NULL,
  remarks                 text NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_procurement.delivery_challan IS
'Delivery Challan — auto-generated on stock issue. Cannot be manually created. dc_type = STO or SALES. Transport info (vehicle, LR) filled by Gate Exit handler at dispatch.';

-- ── DC Lines ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.delivery_challan_line (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dc_id           uuid NOT NULL
    REFERENCES erp_procurement.delivery_challan(id)
    ON DELETE RESTRICT,
  line_number     int NOT NULL,

  -- Cross-schema — plain uuid
  material_id     uuid NOT NULL,

  -- STO line ref (intra-schema)
  sto_line_id     uuid NULL
    REFERENCES erp_procurement.stock_transfer_order_line(id)
    ON DELETE RESTRICT,

  -- SO line ref — plain uuid (SO table in Gate-13.9)
  so_line_id      uuid NULL,

  quantity        numeric(20, 6) NOT NULL,
  uom_code        text NOT NULL,
  unit_value      numeric(20, 4) NULL,
  line_total      numeric(20, 4) NULL,

  -- erp_inventory stock document reference
  stock_document_id uuid NULL,  -- plain uuid

  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (dc_id, line_number)
);

COMMIT;
```

---

### Migration 13.7.3 — Gate Exit Outbound
**File:** `20260511072000_gate13_7_13_7_3_create_gate_exit_outbound.sql`

```sql
/*
 * File-ID: 13.7.3
 * File-Path: supabase/migrations/20260511072000_gate13_7_13_7_3_create_gate_exit_outbound.sql
 * Gate: 13.7
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Outbound Gate Exit — truck exit on STO dispatch or Sales dispatch. Weighment for BULK/TANKER.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.gate_exit_outbound (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (GXO series)
  exit_number       text NOT NULL UNIQUE,

  exit_date         date NOT NULL,
  exit_time         time NULL,
  system_created_at timestamptz NOT NULL DEFAULT now(),

  -- STO or SALES
  exit_type         text NOT NULL
    CHECK (exit_type IN ('STO', 'SALES', 'RTV')),

  -- Cross-schema — plain uuid, NO FK
  company_id        uuid NOT NULL,
  plant_id          uuid NULL,

  -- Intra-schema FKs (nullable — only one populated based on exit_type)
  sto_id            uuid NULL
    REFERENCES erp_procurement.stock_transfer_order(id)
    ON DELETE RESTRICT,

  -- Sales order / RTV ref — plain uuid (tables in later gates)
  sales_order_id    uuid NULL,   -- → erp_procurement.sales_order
  rtv_id            uuid NULL,   -- → erp_procurement.return_to_vendor

  -- DC reference
  dc_id             uuid NULL
    REFERENCES erp_procurement.delivery_challan(id)
    ON DELETE RESTRICT,

  vehicle_number    text NOT NULL,
  driver_name       text NULL,
  gate_staff_id     uuid NOT NULL,

  -- Transporter — cross-schema plain uuid or free text
  transporter_id    uuid NULL,
  transporter_freetext text NULL,
  lr_number         text NULL,

  -- ── Weighment Fields (BULK/TANKER mandatory, STANDARD optional) ───────────
  rst_number        text NULL,
  gross_weight      numeric(20, 6) NULL CHECK (gross_weight >= 0),
  tare_weight       numeric(20, 6) NULL CHECK (tare_weight >= 0),
  net_weight        numeric(20, 6) NULL CHECK (net_weight >= 0),

  dispatch_qty      numeric(20, 6) NOT NULL,

  remarks           text NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_procurement.gate_exit_outbound IS
'Outbound Gate Exit for STO dispatch, Sales dispatch, and RTV (return to vendor). Same weighment rules as GE: BULK/TANKER mandatory, STANDARD optional. LR Number flows back to STO/CSN tracker.';

COMMIT;
```

---

### Migration 13.7.4 — STO Indexes
**File:** `20260511073000_gate13_7_13_7_4_create_sto_indexes.sql`

```sql
/*
 * File-ID: 13.7.4
 * File-Path: supabase/migrations/20260511073000_gate13_7_13_7_4_create_sto_indexes.sql
 * Gate: 13.7
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on STO, DC, and Gate Exit Outbound tables.
 * Authority: Backend
 */

BEGIN;

CREATE INDEX IF NOT EXISTS idx_sto_number   ON erp_procurement.stock_transfer_order (sto_number);
CREATE INDEX IF NOT EXISTS idx_sto_sending  ON erp_procurement.stock_transfer_order (sending_company_id);
CREATE INDEX IF NOT EXISTS idx_sto_recv     ON erp_procurement.stock_transfer_order (receiving_company_id);
CREATE INDEX IF NOT EXISTS idx_sto_status   ON erp_procurement.stock_transfer_order (status);
CREATE INDEX IF NOT EXISTS idx_sto_csn      ON erp_procurement.stock_transfer_order (related_csn_id) WHERE related_csn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stol_sto     ON erp_procurement.stock_transfer_order_line (sto_id);
CREATE INDEX IF NOT EXISTS idx_stol_mat     ON erp_procurement.stock_transfer_order_line (material_id);

CREATE INDEX IF NOT EXISTS idx_dc_number    ON erp_procurement.delivery_challan (dc_number);
CREATE INDEX IF NOT EXISTS idx_dc_sto       ON erp_procurement.delivery_challan (sto_id) WHERE sto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dc_so        ON erp_procurement.delivery_challan (sales_order_id) WHERE sales_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gxo_company  ON erp_procurement.gate_exit_outbound (company_id);
CREATE INDEX IF NOT EXISTS idx_gxo_sto      ON erp_procurement.gate_exit_outbound (sto_id) WHERE sto_id IS NOT NULL;

GRANT SELECT ON erp_procurement.stock_transfer_order      TO authenticated;
GRANT SELECT ON erp_procurement.stock_transfer_order_line TO authenticated;
GRANT SELECT ON erp_procurement.delivery_challan          TO authenticated;
GRANT SELECT ON erp_procurement.delivery_challan_line     TO authenticated;
GRANT SELECT ON erp_procurement.gate_exit_outbound        TO authenticated;
GRANT ALL    ON erp_procurement.stock_transfer_order      TO service_role;
GRANT ALL    ON erp_procurement.stock_transfer_order_line TO service_role;
GRANT ALL    ON erp_procurement.delivery_challan          TO service_role;
GRANT ALL    ON erp_procurement.delivery_challan_line     TO service_role;
GRANT ALL    ON erp_procurement.gate_exit_outbound        TO service_role;

COMMIT;
```

---

## 3. Verification — Claude Will Check

1. STO sto_number UNIQUE, sto_type CHECK (2 values), status CHECK (5 values)
2. `stock_transfer_order_line` UNIQUE(sto_id, line_number), balance_qty field present
3. `delivery_challan` dc_number UNIQUE, dc_type CHECK (STO/SALES), sales_order_id plain uuid
4. `delivery_challan_line` sto_line_id intra-schema FK, so_line_id plain uuid
5. `gate_exit_outbound` exit_type CHECK (STO/SALES/RTV), sales_order_id + rtv_id plain uuid
6. All cross-schema ID fields are plain uuid (no REFERENCES)
7. GRANT SELECT to authenticated on all 5 tables

---

*Spec frozen: 2026-05-11 | Reference: Section 92*
