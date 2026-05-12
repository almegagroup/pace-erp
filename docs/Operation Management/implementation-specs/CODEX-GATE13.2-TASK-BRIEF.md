# CODEX TASK BRIEF — Gate-13.2: Purchase Order DB (erp_procurement)

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-11
**Gate:** 13.2
**Dependency status:** Gate-13.1 VERIFIED ✅ — proceed
**Your task:** Create 5 SQL migration files. Nothing else.

---

## Step 1 — Read These Files First

1. `docs/Operation Management/implementation-specs/OM-GATE-13.2-PurchaseOrder-DB-Spec.md`
   → Complete spec. All SQL is written there. Copy exactly.

2. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`
   → Update after each item.

---

## Step 2 — What You Are Building

The `erp_procurement` schema (new) and the full Purchase Order tables.

```
erp_procurement schema + document_number_series + invoice_number_series
    ↓
purchase_order (header)
    ↓
purchase_order_line (lines — mandatory cost center, ASL reference)
    ↓
po_approval_log (append-only)
    ↓
po_amendment_log (rate/qty → approval; others → free)
```

**NOTE:** The original CODEX-GATE13-TASK-BRIEF.md is SUPERSEDED. Do not implement it.

**This gate is DB structures only. No handlers. No frontend.**

---

## Step 3 — Files to Create

| File | What it does |
|---|---|
| `20260511020000_gate13_2_13_2_1_create_erp_procurement_schema.sql` | Schema + grants + number series + generator functions |
| `20260511021000_gate13_2_13_2_2_create_purchase_order.sql` | PO header + PO lines |
| `20260511022000_gate13_2_13_2_3_create_po_approval_log.sql` | PO approval audit log |
| `20260511023000_gate13_2_13_2_4_create_po_amendment_log.sql` | PO amendment audit log |
| `20260511024000_gate13_2_13_2_5_create_po_indexes.sql` | All indexes + grants |

All go in: `supabase/migrations/`

---

## Step 4 — File Header

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

## Step 5 — Critical Rules

### Rule 1: NO cross-schema FK constraints
These columns are plain uuid — NO REFERENCES clause:
- `purchase_order.company_id` → erp_master.companies
- `purchase_order.plant_id` → erp_master.projects
- `purchase_order.vendor_id` → erp_master.vendor_master
- `purchase_order.payment_term_id` → erp_master.payment_terms_master
- `purchase_order_line.material_id` → erp_master.material_master
- `purchase_order_line.cost_center_id` → erp_master.cost_center_master
- `purchase_order_line.receiving_location_id` → erp_inventory.storage_location_master
- `purchase_order_line.vendor_material_info_id` → erp_master.vendor_material_info

### Rule 2: Intra-schema FKs ARE correct
- `purchase_order_line.po_id` → `erp_procurement.purchase_order(id)`
- `po_approval_log.po_id` → `erp_procurement.purchase_order(id)`
- `po_amendment_log.po_id` → `erp_procurement.purchase_order(id)`
- `po_amendment_log.po_line_id` → `erp_procurement.purchase_order_line(id)`

### Rule 3: ordered_qty_base_uom is NULLABLE
```sql
ordered_qty_base_uom numeric(20, 6) NULL
```
NULL when variable_conversion = true. Never default to zero.

### Rule 4: purchase_order status CHECK — 6 values
```sql
CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CONFIRMED', 'CLOSED', 'CANCELLED'))
```

### Rule 5: delivery_type CHECK — 3 values
```sql
CHECK (delivery_type IN ('STANDARD', 'BULK', 'TANKER'))
```

### Rule 6: freight_term CHECK — 2 values
```sql
CHECK (freight_term IN ('FOR', 'FREIGHT_SEPARATE'))
```

### Rule 7: cost_center_id is NOT NULL
Mandatory per line (Section 87.3). No auto-populate. No default. Plain uuid NOT NULL.

### Rule 8: document_number_series seeded with 14 doc types
CSN, GE, GEX, GXO, GRN, QA, STO, DC, RTV, DN, EXR, IV, LC, SO

### Rule 9: Both generator functions are SECURITY DEFINER
`generate_doc_number()` and `generate_invoice_number()`

---

## Step 6 — Self-Check

```
[ ] erp_procurement schema created with GRANT USAGE to authenticated + service_role
[ ] document_number_series has 14 rows seeded
[ ] invoice_number_series singleton row exists (id=1)
[ ] generate_doc_number() SECURITY DEFINER — raises UNKNOWN_DOC_TYPE on bad input
[ ] generate_invoice_number() SECURITY DEFINER — format: YYYYMM + 6-digit zero-padded
[ ] purchase_order: UNIQUE po_number
[ ] purchase_order: status CHECK (6 values)
[ ] purchase_order: delivery_type CHECK (STANDARD/BULK/TANKER), DEFAULT STANDARD
[ ] purchase_order: freight_term CHECK (FOR/FREIGHT_SEPARATE), NOT NULL
[ ] purchase_order: lc_required boolean NOT NULL DEFAULT false
[ ] purchase_order: has_rebate boolean NOT NULL DEFAULT false
[ ] purchase_order: indent_required boolean NOT NULL DEFAULT false
[ ] purchase_order_line: UNIQUE(po_id, line_number)
[ ] purchase_order_line: ordered_qty_base_uom nullable (not NOT NULL)
[ ] purchase_order_line: cost_center_id plain uuid NOT NULL (no FK)
[ ] purchase_order_line: vendor_material_info_id plain uuid NOT NULL (no FK)
[ ] po_approval_log: intra-schema FK to purchase_order OK
[ ] po_amendment_log: requires_approval boolean DEFAULT false
[ ] All tables GRANT SELECT to authenticated, GRANT ALL to service_role
[ ] No cross-schema FK anywhere
[ ] No tables in public schema
```

---

## Step 7 — Log Update

File: `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

After each file:
```
| 13.2.X | item name | DONE | supabase/migrations/filename.sql | - | - |
```
After all 5:
```
Gate-13.2 implementation complete. All 5 migrations created. Awaiting Claude verification.
```

---

## Step 8 — Hard Stop

After Gate-13.2, stop. Claude verifies. Then Gate-13.3 (CSN) brief will be issued.

---

*Task issued: 2026-05-11*
*Gate-13.1 VERIFIED ✅*
*Do not start Gate-13.3 until Claude marks Gate-13.2 VERIFIED.*
