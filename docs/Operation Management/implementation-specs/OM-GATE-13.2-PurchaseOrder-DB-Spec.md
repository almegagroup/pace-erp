# OM-GATE-13.2 — Purchase Order DB Spec
# PACE-ERP Operation Management — erp_procurement Schema + Full PO Lifecycle Tables

**Gate:** 13.2
**Phase:** Operation Management — Layer 2
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-13.1 VERIFIED ✅
**Implementer:** Codex
**Verifier:** Claude
**Design Reference:** Sections 87.2–87.12, 90.1, 90.3–90.5, 91.1

---

## 1. Codex Instructions — Read This First

**What you are building:**
- The `erp_procurement` schema (new)
- Full Purchase Order tables: `purchase_order` + `purchase_order_line`
- PO approval log and amendment log
- Number series infrastructure for erp_procurement documents

**Note:** The original Gate-13 brief (CODEX-GATE13-TASK-BRIEF.md) is superseded by this L2 gate structure. Do NOT implement the original Gate-13 brief. This gate replaces it.

**What you must NOT do:**
- Do NOT create CSN, GE, GRN tables — those are later gates
- Do NOT create cross-schema FK constraints (company_id, plant_id, vendor_id, material_id are plain uuid)
- Do NOT create handlers or frontend

**File header:**
```sql
/*
 * File-ID: 13.2.X
 * File-Path: supabase/migrations/20260511HHMMSS_gate13_2_13_2_X_description.sql
 * Gate: 13.2
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: One sentence.
 * Authority: Backend
 */
```

---

## 2. Migration Files — Exact Sequence

---

### Migration 13.2.1 — Create erp_procurement Schema
**File:** `20260511020000_gate13_2_13_2_1_create_erp_procurement_schema.sql`

```sql
/*
 * File-ID: 13.2.1
 * File-Path: supabase/migrations/20260511020000_gate13_2_13_2_1_create_erp_procurement_schema.sql
 * Gate: 13.2
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Create erp_procurement schema and grant access.
 * Authority: Backend
 */

BEGIN;

CREATE SCHEMA IF NOT EXISTS erp_procurement;

GRANT USAGE ON SCHEMA erp_procurement TO authenticated;
GRANT USAGE ON SCHEMA erp_procurement TO service_role;
GRANT ALL   ON ALL TABLES IN SCHEMA erp_procurement TO service_role;
GRANT ALL   ON ALL SEQUENCES IN SCHEMA erp_procurement TO service_role;

-- Global document number series for erp_procurement
-- One counter per document type. All are global (no company/FY scope).
CREATE TABLE IF NOT EXISTS erp_procurement.document_number_series (
  doc_type      text PRIMARY KEY,
  last_number   bigint NOT NULL DEFAULT 0,
  -- Width of the zero-padded number string
  pad_width     int NOT NULL DEFAULT 6
);

-- Seed all document types for erp_procurement
INSERT INTO erp_procurement.document_number_series (doc_type, pad_width) VALUES
  ('CSN',      6),  -- Consignment Note:      000001
  ('GE',       6),  -- Gate Entry:             000001
  ('GEX',      6),  -- Gate Exit (inbound):    000001
  ('GXO',      6),  -- Gate Exit (outbound):   000001
  ('GRN',      6),  -- Goods Receipt Note:     000001
  ('QA',       6),  -- QA Document:            000001
  ('STO',      6),  -- Stock Transfer Order:   000001
  ('DC',       6),  -- Delivery Challan:       000001
  ('RTV',      6),  -- Return to Vendor:       000001
  ('DN',       6),  -- Debit Note:             000001
  ('EXR',      6),  -- Exchange Reference:     000001
  ('IV',       6),  -- Invoice Verification:   000001
  ('LC',       6),  -- Landed Cost:            000001
  ('SO',       6)   -- Sales Order:            000001
ON CONFLICT (doc_type) DO NOTHING;

-- Invoice number series (special format: YYYYMM + incremental — Section 99.3)
CREATE TABLE IF NOT EXISTS erp_procurement.invoice_number_series (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_number bigint NOT NULL DEFAULT 0
);
INSERT INTO erp_procurement.invoice_number_series (id, last_number) VALUES (1, 0)
ON CONFLICT DO NOTHING;

-- Function: generate next document number (global, pure numeric)
CREATE OR REPLACE FUNCTION erp_procurement.generate_doc_number(p_doc_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row erp_procurement.document_number_series%ROWTYPE;
BEGIN
  UPDATE erp_procurement.document_number_series
  SET last_number = last_number + 1
  WHERE doc_type = p_doc_type
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_DOC_TYPE: %', p_doc_type;
  END IF;

  RETURN lpad(v_row.last_number::text, v_row.pad_width, '0');
END;
$$;

-- Function: generate invoice number (YYYYMM + incremental — never resets)
CREATE OR REPLACE FUNCTION erp_procurement.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next  bigint;
  v_yyyymm text;
BEGIN
  UPDATE erp_procurement.invoice_number_series
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;

  v_yyyymm := to_char(now(), 'YYYYMM');
  RETURN v_yyyymm || lpad(v_next::text, 6, '0');
END;
$$;

COMMIT;
```

---

### Migration 13.2.2 — Purchase Order + Lines
**File:** `20260511021000_gate13_2_13_2_2_create_purchase_order.sql`

```sql
/*
 * File-ID: 13.2.2
 * File-Path: supabase/migrations/20260511021000_gate13_2_13_2_2_create_purchase_order.sql
 * Gate: 13.2
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Purchase Order header and lines — full L2 field set including Incoterms, Freight Term, LC Required, Rebate, Indent flags.
 * Authority: Backend
 */

BEGIN;

-- ── Purchase Order Header ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.purchase_order (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- PO number: Company + Section prefix/suffix format (Section 33 / Section 99)
  -- Generated by handler using company-specific number series. Stored here.
  po_number               text NOT NULL UNIQUE,

  po_date                 date NOT NULL,
  -- system_created_at always set to now() — user po_date for backdating
  system_created_at       timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema references — plain uuid, NO FK
  company_id              uuid NOT NULL,   -- → erp_master.companies
  plant_id                uuid NULL,       -- → erp_master.projects (destination plant, if known at PO)
  vendor_id               uuid NOT NULL,   -- → erp_master.vendor_master

  -- DOMESTIC | IMPORT
  vendor_type             text NOT NULL
    CHECK (vendor_type IN ('DOMESTIC', 'IMPORT')),

  -- Import POs: dynamic last-used Incoterm (Section 87.2)
  -- Domestic POs: NULL (not applicable)
  incoterm                text NULL,

  -- Freight Terms (Section 87.9) — mandatory on all POs
  -- FOR = vendor delivers to plant (no freight entry)
  -- FREIGHT_SEPARATE = buyer pays freight
  freight_term            text NOT NULL
    CHECK (freight_term IN ('FOR', 'FREIGHT_SEPARATE')),

  -- Payment Terms reference → erp_master.payment_terms_master(id)
  -- Plain UUID: cross-schema reference, no FK
  payment_term_id         uuid NOT NULL,

  -- LC Required: auto-derived when payment_method = LC on payment term
  -- Carries into CSN tracker
  lc_required             boolean NOT NULL DEFAULT false,

  -- Delivery Type (Section 91.1): drives CSN type
  -- STANDARD → IMPORT or DOMESTIC CSN
  -- BULK / TANKER → BULK CSN (weighment-based)
  delivery_type           text NOT NULL DEFAULT 'STANDARD'
    CHECK (delivery_type IN ('STANDARD', 'BULK', 'TANKER')),

  -- Rebate flag (Section 90.3) — carries to CSN
  has_rebate              boolean NOT NULL DEFAULT false,
  rebate_remarks          text NULL,

  -- Indent Required flag (Section 90.4) — inherited from vendor_master.indent_number_required
  -- Overridable per PO by Procurement
  indent_required         boolean NOT NULL DEFAULT false,

  -- Expected delivery date (for planning reference)
  expected_delivery_date  date NULL,

  -- PO Status flow
  -- DRAFT → PENDING_APPROVAL → APPROVED → CONFIRMED → CLOSED | CANCELLED
  status                  text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CONFIRMED', 'CLOSED', 'CANCELLED')),

  -- Cancellation
  cancellation_reason     text NULL,
  cancelled_at            timestamptz NULL,
  cancelled_by            uuid NULL,

  -- PO auto-mail: sent on CONFIRMED status
  po_mail_sent_at         timestamptz NULL,

  remarks                 text NULL,

  -- Audit
  created_by              uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  approved_by             uuid NULL,
  approved_at             timestamptz NULL,
  last_updated_at         timestamptz NULL,
  last_updated_by         uuid NULL
);

COMMENT ON TABLE erp_procurement.purchase_order IS
'Purchase Order header. One PO per company. No cross-company PO. PO number uses company+section prefix/suffix format. CSN auto-created per line on CONFIRMED status. Cancellation: no approval, reason mandatory, zero-receipt condition.';

COMMENT ON COLUMN erp_procurement.purchase_order.lc_required IS
'Auto-set by handler when payment_term.payment_method = LC. Carries into CSN LC tracking section.';

COMMENT ON COLUMN erp_procurement.purchase_order.delivery_type IS
'STANDARD = regular CSN tracking. BULK/TANKER = BULK CSN (weighment-based, simplified tracking, multiple GEs per CSN).';

-- ── Purchase Order Lines ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_procurement.purchase_order_line (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK — purchase_order is in erp_procurement
  po_id                   uuid NOT NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  line_number             int NOT NULL,

  -- Cross-schema references — plain uuid, NO FK
  material_id             uuid NOT NULL,   -- → erp_master.material_master
  cost_center_id          uuid NOT NULL,   -- → erp_master.cost_center_master (Section 87.3 — mandatory)

  -- Receiving storage location — plain uuid, NO FK (cross-schema to erp_inventory)
  receiving_location_id   uuid NULL,       -- → erp_inventory.storage_location_master

  -- vendor_material_info_id: Approved Source List check reference
  -- Plain UUID — cross-schema to erp_master
  vendor_material_info_id uuid NOT NULL,   -- → erp_master.vendor_material_info

  ordered_qty             numeric(20, 6) NOT NULL CHECK (ordered_qty > 0),

  -- UOM in which PO is raised (from vendor_material_info.po_uom_code)
  po_uom_code             text NOT NULL,

  -- ordered_qty in base UOM — NULL when variable_conversion = true (actual weight known at GRN only)
  -- Section 87 Rule 5 from original Gate-13 spec
  ordered_qty_base_uom    numeric(20, 6) NULL,

  -- Rate in PO currency
  unit_rate               numeric(20, 4) NOT NULL CHECK (unit_rate > 0),

  -- Total value = ordered_qty × unit_rate
  total_value             numeric(20, 4) NOT NULL,

  -- Open qty: reduced by GRN. Starts = ordered_qty
  open_qty                numeric(20, 6) NOT NULL,

  -- Status per line
  -- OPEN → PARTIALLY_RECEIVED → FULLY_RECEIVED | KNOCKED_OFF | CANCELLED
  line_status             text NOT NULL DEFAULT 'OPEN'
    CHECK (line_status IN ('OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'KNOCKED_OFF', 'CANCELLED')),

  knock_off_reason        text NULL,
  knocked_off_at          timestamptz NULL,
  knocked_off_by          uuid NULL,

  remarks                 text NULL,

  created_at              timestamptz NOT NULL DEFAULT now(),
  last_updated_at         timestamptz NULL,

  UNIQUE (po_id, line_number)
);

COMMENT ON TABLE erp_procurement.purchase_order_line IS
'PO line. cost_center_id is mandatory per line (no auto-populate — same material goes to different cost centers). vendor_material_info_id must reference an ACTIVE ASL record for this vendor+material.';

COMMENT ON COLUMN erp_procurement.purchase_order_line.ordered_qty_base_uom IS
'NULL when variable_conversion = true on the vendor_material_info record — actual weight is only known at GRN time.';

COMMIT;
```

---

### Migration 13.2.3 — PO Approval Log
**File:** `20260511022000_gate13_2_13_2_3_create_po_approval_log.sql`

```sql
/*
 * File-ID: 13.2.3
 * File-Path: supabase/migrations/20260511022000_gate13_2_13_2_3_create_po_approval_log.sql
 * Gate: 13.2
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: PO approval log — tracks every approval action with reason.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.po_approval_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK
  po_id       uuid NOT NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  -- APPROVED | REJECTED | ESCALATED
  action      text NOT NULL
    CHECK (action IN ('APPROVED', 'REJECTED', 'ESCALATED')),

  -- From status → to status
  from_status text NOT NULL,
  to_status   text NOT NULL,

  remarks     text NULL,
  actioned_by uuid NOT NULL,
  actioned_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_procurement.po_approval_log IS
'Append-only audit log of every PO approval action. Never updated — only inserted.';

CREATE INDEX IF NOT EXISTS idx_pal_po ON erp_procurement.po_approval_log (po_id);

GRANT SELECT ON erp_procurement.po_approval_log TO authenticated;
GRANT ALL    ON erp_procurement.po_approval_log TO service_role;

COMMIT;
```

---

### Migration 13.2.4 — PO Amendment Log
**File:** `20260511023000_gate13_2_13_2_4_create_po_amendment_log.sql`

```sql
/*
 * File-ID: 13.2.4
 * File-Path: supabase/migrations/20260511023000_gate13_2_13_2_4_create_po_amendment_log.sql
 * Gate: 13.2
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: PO amendment log — tracks field changes, flags which need approval.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.po_amendment_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK
  po_id               uuid NOT NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  po_line_id          uuid NULL
    REFERENCES erp_procurement.purchase_order_line(id)
    ON DELETE RESTRICT,

  amendment_number    int NOT NULL,

  -- Field that was changed
  field_changed       text NOT NULL,
  old_value           text NULL,
  new_value           text NULL,

  -- Rate or Qty changes require approval (Section 87.11)
  requires_approval   boolean NOT NULL DEFAULT false,

  -- PENDING | APPROVED | REJECTED
  approval_status     text NOT NULL DEFAULT 'APPROVED'
    CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),

  approved_by         uuid NULL,
  approved_at         timestamptz NULL,
  rejection_reason    text NULL,

  amended_by          uuid NOT NULL,
  amended_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_procurement.po_amendment_log IS
'Append-only amendment audit. requires_approval = true for rate and qty changes (Procurement Head approval required). All other fields = false (free amendment).';

COMMENT ON COLUMN erp_procurement.po_amendment_log.requires_approval IS
'TRUE for field_changed IN (unit_rate, ordered_qty). FALSE for all other fields (delivery date, remarks, cost center, incoterm, payment terms).';

CREATE INDEX IF NOT EXISTS idx_paml_po   ON erp_procurement.po_amendment_log (po_id);
CREATE INDEX IF NOT EXISTS idx_paml_line ON erp_procurement.po_amendment_log (po_line_id) WHERE po_line_id IS NOT NULL;

GRANT SELECT ON erp_procurement.po_amendment_log TO authenticated;
GRANT ALL    ON erp_procurement.po_amendment_log TO service_role;

COMMIT;
```

---

### Migration 13.2.5 — PO Indexes
**File:** `20260511024000_gate13_2_13_2_5_create_po_indexes.sql`

```sql
/*
 * File-ID: 13.2.5
 * File-Path: supabase/migrations/20260511024000_gate13_2_13_2_5_create_po_indexes.sql
 * Gate: 13.2
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Indexes on purchase_order and purchase_order_line for common query patterns.
 * Authority: Backend
 */

BEGIN;

-- purchase_order indexes
CREATE INDEX IF NOT EXISTS idx_po_company         ON erp_procurement.purchase_order (company_id);
CREATE INDEX IF NOT EXISTS idx_po_vendor          ON erp_procurement.purchase_order (vendor_id);
CREATE INDEX IF NOT EXISTS idx_po_status          ON erp_procurement.purchase_order (status);
CREATE INDEX IF NOT EXISTS idx_po_date            ON erp_procurement.purchase_order (po_date);
CREATE INDEX IF NOT EXISTS idx_po_delivery_type   ON erp_procurement.purchase_order (delivery_type);
CREATE INDEX IF NOT EXISTS idx_po_lc_required     ON erp_procurement.purchase_order (lc_required) WHERE lc_required = true;

-- purchase_order_line indexes
CREATE INDEX IF NOT EXISTS idx_pol_po             ON erp_procurement.purchase_order_line (po_id);
CREATE INDEX IF NOT EXISTS idx_pol_material       ON erp_procurement.purchase_order_line (material_id);
CREATE INDEX IF NOT EXISTS idx_pol_status         ON erp_procurement.purchase_order_line (line_status);
CREATE INDEX IF NOT EXISTS idx_pol_open           ON erp_procurement.purchase_order_line (po_id, line_status) WHERE line_status = 'OPEN';

-- Grants
GRANT SELECT ON erp_procurement.purchase_order      TO authenticated;
GRANT SELECT ON erp_procurement.purchase_order_line TO authenticated;
GRANT ALL    ON erp_procurement.purchase_order      TO service_role;
GRANT ALL    ON erp_procurement.purchase_order_line TO service_role;
GRANT ALL    ON erp_procurement.document_number_series TO service_role;
GRANT ALL    ON erp_procurement.invoice_number_series  TO service_role;

COMMIT;
```

---

## 3. Business Rules Codex Must Know (For Handler Phase)

| Rule | Enforcement |
|---|---|
| PO line vendor+material must have ACTIVE vendor_material_info | Handler checks erp_master.vendor_material_info status = ACTIVE before saving line |
| lc_required auto-set | Handler fetches payment_terms_master.payment_method; if LC → set lc_required = true |
| indent_required default | Handler reads vendor_master.indent_number_required; copies to po.indent_required |
| Cancellation condition | PO must have zero GRN qty on all lines. Handler checks before cancelling |
| Amendment approval | Handler checks field_changed: unit_rate/ordered_qty → requires_approval = true |
| PO Auto-mail | Handler sends PDF on status → CONFIRMED |
| CSN auto-creation | Handler creates one CSN per PO line when status → CONFIRMED |

---

## 4. Cross-Schema References (NO FK) in purchase_order

| Column | References (logically) | Rule |
|---|---|---|
| company_id | erp_master.companies | Plain uuid NOT NULL |
| plant_id | erp_master.projects | Plain uuid NULL |
| vendor_id | erp_master.vendor_master | Plain uuid NOT NULL |
| payment_term_id | erp_master.payment_terms_master | Plain uuid NOT NULL |

## Cross-Schema References (NO FK) in purchase_order_line

| Column | References (logically) | Rule |
|---|---|---|
| material_id | erp_master.material_master | Plain uuid NOT NULL |
| cost_center_id | erp_master.cost_center_master | Plain uuid NOT NULL |
| receiving_location_id | erp_inventory.storage_location_master | Plain uuid NULL |
| vendor_material_info_id | erp_master.vendor_material_info | Plain uuid NOT NULL |

---

## 5. Log Update Instructions

After each migration:
```
| 13.2.X | <item name> | DONE | supabase/migrations/<filename>.sql | — | — |
```
After all 5:
```
Gate-13.2 implementation complete. All 5 migrations created. Awaiting Claude verification.
```

---

## 6. Verification — Claude Will Check

1. `erp_procurement` schema created with GRANT to authenticated + service_role
2. `document_number_series` seeded with 14 doc types
3. `generate_doc_number()` and `generate_invoice_number()` are SECURITY DEFINER
4. `purchase_order` has UNIQUE po_number, all status CHECK values, delivery_type CHECK
5. `purchase_order` has lc_required, has_rebate, indent_required, freight_term
6. `purchase_order_line` has UNIQUE(po_id, line_number), ordered_qty_base_uom is nullable
7. `purchase_order_line.cost_center_id` is plain uuid NOT NULL (no FK, no default)
8. `purchase_order_line.vendor_material_info_id` is plain uuid NOT NULL (no FK)
9. `po_approval_log` is append-only — no UPDATE trigger or RLS preventing it
10. `po_amendment_log` has requires_approval boolean with DEFAULT false
11. No tables in public schema

---

*Spec frozen: 2026-05-11*
*Reference: Sections 87.2–87.12, 90.1, 90.3–90.5, 91.1*
