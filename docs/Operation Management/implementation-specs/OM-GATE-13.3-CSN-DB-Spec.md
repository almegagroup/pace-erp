# OM-GATE-13.3 — Consignment Note (CSN) DB Spec
# PACE-ERP Operation Management — erp_procurement

**Gate:** 13.3
**Phase:** Operation Management — Layer 2
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-13.2 VERIFIED ✅
**Design Reference:** Sections 88, 89.9, 90.6, 91.2

---

## 1. What You Are Building

CSN (Consignment Note) — auto-created per PO line on PO confirm.  
Three types: IMPORT / DOMESTIC / BULK. All in `erp_procurement` schema.

---

## 2. Migration Files

---

### Migration 13.3.1 — Consignment Note
**File:** `20260511030000_gate13_3_13_3_1_create_consignment_note.sql`

```sql
/*
 * File-ID: 13.3.1
 * File-Path: supabase/migrations/20260511030000_gate13_3_13_3_1_create_consignment_note.sql
 * Gate: 13.3
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Consignment Note — one per PO line, auto-created on PO confirm. IMPORT/DOMESTIC/BULK types.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.consignment_note (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (000001, 000002...)
  csn_number                      text NOT NULL UNIQUE,

  -- IMPORT | DOMESTIC | BULK
  -- STANDARD PO → IMPORT or DOMESTIC (based on vendor_type)
  -- BULK or TANKER delivery_type on PO → BULK
  csn_type                        text NOT NULL
    CHECK (csn_type IN ('IMPORT', 'DOMESTIC', 'BULK')),

  -- IMPORT/DOMESTIC status: ORDERED → IN_TRANSIT → ARRIVED → GRN_DONE → CLOSED
  -- BULK status: OPEN → CLOSED
  status                          text NOT NULL DEFAULT 'ORDERED'
    CHECK (status IN ('ORDERED', 'IN_TRANSIT', 'ARRIVED', 'GRN_DONE', 'OPEN', 'CLOSED')),

  -- Cross-schema — plain uuid, NO FK
  company_id                      uuid NOT NULL,   -- → erp_master.companies
  vendor_id                       uuid NOT NULL,   -- → erp_master.vendor_master
  material_id                     uuid NOT NULL,   -- → erp_master.material_master
  material_category_id            uuid NULL,       -- → erp_master.material_category_master

  -- Intra-schema FKs — both in erp_procurement
  po_id                           uuid NOT NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  po_line_id                      uuid NOT NULL
    REFERENCES erp_procurement.purchase_order_line(id)
    ON DELETE RESTRICT,

  -- Quantities
  po_qty                          numeric(20, 6) NOT NULL,
  po_uom_code                     text NOT NULL,
  dispatch_qty                    numeric(20, 6) NULL,    -- Entered by Procurement at dispatch
  -- For BULK CSN: cumulative received from all GRNs
  total_received_qty              numeric(20, 6) NOT NULL DEFAULT 0,

  -- ── Mother / Sub CSN ─────────────────────────────────────────────────────
  is_mother_csn                   boolean NOT NULL DEFAULT false,
  -- If this is a Sub CSN — plain uuid reference to parent (intra-table self-reference)
  mother_csn_id                   uuid NULL
    REFERENCES erp_procurement.consignment_note(id)
    ON DELETE RESTRICT,

  -- When Sub CSN transforms to STO — plain uuid, NO FK (STO table created in Gate-13.7)
  sto_id                          uuid NULL,   -- → erp_procurement.stock_transfer_order

  -- ── PO Extended Fields (carried from PO) ─────────────────────────────────
  -- Payment Terms reference — plain uuid, NO FK
  payment_term_id                 uuid NOT NULL,   -- → erp_master.payment_terms_master
  lc_required                     boolean NOT NULL DEFAULT false,
  has_rebate                      boolean NOT NULL DEFAULT false,
  rebate_remarks                  text NULL,
  indent_required                 boolean NOT NULL DEFAULT false,

  -- ── IMPORT-Specific Fields (Section 89.9) ────────────────────────────────
  -- All NULL for DOMESTIC and BULK types
  port_of_loading                 text NULL,
  -- Plain uuid — cross-schema reference to erp_master.port_master
  port_of_discharge_id            uuid NULL,
  vessel_name                     text NULL,
  voyage_number                   text NULL,
  bl_number                       text NULL,
  boe_number                      text NULL,
  -- Plain uuid — cross-schema reference to erp_master.cha_master (or free text below)
  cha_id                          uuid NULL,
  cha_name_freetext               text NULL,  -- If CHA not in master

  -- ETA / Date Fields (Section 89.1 — GSheet reference columns)
  -- O: Scheduled ETA to Port — entered by Procurement at PO creation
  scheduled_eta_to_port           date NULL,
  -- Y: ETD — auto = O − sail_time; manually overridable
  etd                             date NULL,
  etd_is_manual_override          boolean NOT NULL DEFAULT false,
  -- Z: BL Date = Actual Time of Departure
  bl_date                         date NULL,
  -- AH: ETA at Port — auto from ETD + sail_time or BL Date + sail_time; manually overridable
  eta_at_port                     date NULL,
  eta_at_port_is_manual_override  boolean NOT NULL DEFAULT false,
  -- AI: ATA at Port (actual vessel arrival)
  ata_at_port                     date NULL,
  -- AP: Post-Clearance LR Date (truck leaves port)
  post_clearance_lr_date          date NULL,
  -- Transporter for port-to-plant leg — plain uuid or free text
  transporter_id                  uuid NULL,   -- → erp_master.transporter_master
  transporter_name_freetext       text NULL,
  lr_number_port_to_plant         text NULL,
  vehicle_number_port_to_plant    text NULL,

  -- LC Tracking Fields (visible only when lc_required = true — Section 90.1)
  -- LC Due Date: auto = ETD − 10 days; recalculates when ETD changes
  lc_due_date                     date NULL,
  lc_opened_date                  date NULL,
  lc_number                       text NULL,
  -- Vessel Booking (Section 90.2) — Import only
  vessel_booking_confirmed_date   date NULL,

  -- ── DOMESTIC-Specific Fields (Section 89.3) ──────────────────────────────
  -- Z / AP = LR Date for domestic (same field, different meaning)
  lr_date                         date NULL,
  lr_number                       text NULL,
  vehicle_number                  text NULL,
  -- domestic transporter — plain uuid or free text
  domestic_transporter_id         uuid NULL,   -- → erp_master.transporter_master
  domestic_transporter_freetext   text NULL,

  -- ── Vendor Indent (Section 90.4) ─────────────────────────────────────────
  -- Shown only if indent_required = true
  vendor_indent_number            text NULL,

  -- ── Arrival + GRN Fields (All types — Section 89.9) ─────────────────────
  -- AR: Gate Entry Date — auto from GE
  gate_entry_date                 date NULL,
  -- Plain uuid — intra-schema FK would be correct but GE table created in 13.4
  -- Use plain uuid to avoid ordering dependency; handler links after GE is created
  gate_entry_id                   uuid NULL,   -- → erp_procurement.gate_entry
  grn_date                        date NULL,
  grn_id                          uuid NULL,   -- → erp_procurement.goods_receipt
  received_qty                    numeric(20, 6) NULL,

  -- ETA to Plant (calculated) — updated by ETA cascade engine on every date entry
  eta_to_plant_calculated         date NULL,

  -- Invoice reference
  invoice_number                  text NULL,

  remarks                         text NULL,
  created_by                      uuid NOT NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  last_updated_by                 uuid NULL,
  last_updated_at                 timestamptz NULL
);

COMMENT ON TABLE erp_procurement.consignment_note IS
'CSN — one per PO line, auto-created on PO CONFIRMED. Type: IMPORT/DOMESTIC = full tracking + ETA cascade. BULK = simplified, multiple GEs per CSN, weighment-based qty. Mother/Sub CSN hierarchy supported.';

COMMENT ON COLUMN erp_procurement.consignment_note.status IS
'IMPORT/DOMESTIC: ORDERED→IN_TRANSIT→ARRIVED→GRN_DONE→CLOSED. BULK: OPEN→CLOSED (closes when PO balance=0).';

COMMENT ON COLUMN erp_procurement.consignment_note.eta_to_plant_calculated IS
'Auto-recalculated by ETA cascade engine on every date field entry. Priority: AR > AP+transit > AI+clearance+transit > AH+clearance+transit > O+clearance+transit.';

COMMIT;
```

---

### Migration 13.3.2 — CSN Indexes
**File:** `20260511031000_gate13_3_13_3_2_create_csn_indexes.sql`

```sql
/*
 * File-ID: 13.3.2
 * File-Path: supabase/migrations/20260511031000_gate13_3_13_3_2_create_csn_indexes.sql
 * Gate: 13.3
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on consignment_note for common query patterns including alert queries.
 * Authority: Backend
 */

BEGIN;

CREATE INDEX IF NOT EXISTS idx_csn_number     ON erp_procurement.consignment_note (csn_number);
CREATE INDEX IF NOT EXISTS idx_csn_company    ON erp_procurement.consignment_note (company_id);
CREATE INDEX IF NOT EXISTS idx_csn_po         ON erp_procurement.consignment_note (po_id);
CREATE INDEX IF NOT EXISTS idx_csn_po_line    ON erp_procurement.consignment_note (po_line_id);
CREATE INDEX IF NOT EXISTS idx_csn_type       ON erp_procurement.consignment_note (csn_type);
CREATE INDEX IF NOT EXISTS idx_csn_status     ON erp_procurement.consignment_note (status);
CREATE INDEX IF NOT EXISTS idx_csn_material   ON erp_procurement.consignment_note (material_id);
CREATE INDEX IF NOT EXISTS idx_csn_vendor     ON erp_procurement.consignment_note (vendor_id);
CREATE INDEX IF NOT EXISTS idx_csn_mother     ON erp_procurement.consignment_note (mother_csn_id) WHERE mother_csn_id IS NOT NULL;

-- Alert query indexes (Section 90.7)
-- LC Alerts: import CSNs with lc_required = true and LC not complete
CREATE INDEX IF NOT EXISTS idx_csn_lc_alert
  ON erp_procurement.consignment_note (company_id, lc_due_date)
  WHERE lc_required = true
    AND status NOT IN ('GRN_DONE', 'CLOSED');

-- Vessel Booking Alerts: import CSNs with no vessel booking confirmed
CREATE INDEX IF NOT EXISTS idx_csn_vessel_alert
  ON erp_procurement.consignment_note (company_id)
  WHERE csn_type = 'IMPORT'
    AND vessel_booking_confirmed_date IS NULL
    AND status NOT IN ('ARRIVED', 'GRN_DONE', 'CLOSED');

GRANT SELECT ON erp_procurement.consignment_note TO authenticated;
GRANT ALL    ON erp_procurement.consignment_note TO service_role;

COMMIT;
```

---

## 3. Critical Rules

| Rule | Detail |
|---|---|
| csn_type CHECK | IN ('IMPORT', 'DOMESTIC', 'BULK') |
| status CHECK | IN ('ORDERED','IN_TRANSIT','ARRIVED','GRN_DONE','OPEN','CLOSED') |
| mother_csn_id | Intra-table self-reference FK — correct (same table, same schema) |
| sto_id | Plain uuid NULL — STO table created in Gate-13.7 |
| gate_entry_id, grn_id | Plain uuid NULL — tables created in later gates. Handler links. |
| No cross-schema FKs | company_id, vendor_id, material_id, payment_term_id, port_of_discharge_id, cha_id, transporter_id — all plain uuid |
| BULK CSN total_received_qty | Starts at 0. Incremented by GRN posting handler |

---

## 4. Verification — Claude Will Check

1. `consignment_note` exists in `erp_procurement` schema
2. csn_type CHECK covers IMPORT/DOMESTIC/BULK
3. status CHECK covers all 6 values
4. `mother_csn_id` has self-referencing FK on `consignment_note(id)` — intra-table
5. `sto_id`, `gate_entry_id`, `grn_id` are plain uuid NULL (no FK)
6. All cross-schema ID fields are plain uuid (no REFERENCES clause)
7. Both alert indexes created (idx_csn_lc_alert, idx_csn_vessel_alert)
8. GRANT SELECT to authenticated, GRANT ALL to service_role

---

*Spec frozen: 2026-05-11 | Reference: Sections 88, 89.9, 90.6, 91.2*
