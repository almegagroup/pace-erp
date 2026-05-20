# CODEX TASK BRIEF — Gate-13: erp_procurement DB

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-09
**Gate:** 13
**Dependency status:** Gate-11 VERIFIED ✅ | Gate-12 VERIFIED ✅ — proceed
**Your task:** Create 5 SQL migration files. Nothing else.

---

## Step 1 — Read These Files First

1. `docs/Operation Management/implementation-specs/OM-GATE-13-Procurement-DB-Spec.md`
   → Complete spec. All SQL is written there. Copy exactly.

2. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`
   → Update after each item. Gate-13 section is already added.

---

## Step 2 — What You Are Building

A new schema `erp_procurement` with 3 transaction tables (each split into header + lines):

```
purchase_order          → purchase_order_line
gate_entry              → gate_entry_line
goods_receipt           → goods_receipt_line
```

**Business flow this supports:**
```
PO created → Gate Entry logged → GRN posted → Stock updated
```

This gate is **DB structures only**. No handlers. No frontend.

---

## Step 3 — Files to Create

| File | What it does |
|---|---|
| `20260509130000_gate13_13_1_create_erp_procurement_schema.sql` | New schema + grants |
| `20260509131000_gate13_13_2_create_purchase_order.sql` | PO header + PO lines |
| `20260509132000_gate13_13_3_create_gate_entry.sql` | Gate Entry header + lines |
| `20260509133000_gate13_13_4_create_goods_receipt.sql` | GRN header + lines |
| `20260509134000_gate13_13_5_create_procurement_indexes.sql` | All indexes |

All go in: `supabase/migrations/`

---

## Step 4 — File Header (use this format exactly)

```sql
/*
 * File-ID: 13.X
 * File-Path: supabase/migrations/20260509HHMMSS_gate13_13_X_description.sql
 * Gate: 13
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: One sentence.
 * Authority: Backend
 */
```

---

## Step 5 — Critical Rules

### Rule 1: NO cross-schema FK constraints
These columns reference tables in other schemas — write them as plain `uuid NOT NULL` or `uuid NULL`. NO `REFERENCES` clause:
- `company_id` → erp_master.companies
- `plant_id` → erp_master.projects
- `vendor_id` → erp_master.vendor_master
- `material_id` → erp_master.material_master
- `vendor_material_info_id` → erp_master.vendor_material_info
- `stock_document_id` → erp_inventory.stock_document
- `stock_ledger_id` → erp_inventory.stock_ledger
- `receiving_location_id` → erp_inventory.storage_location_master

### Rule 2: Intra-schema FKs ARE allowed
These stay within erp_procurement, so FK constraints are correct:
- `purchase_order_line.po_id` → `erp_procurement.purchase_order(id)`
- `gate_entry_line.po_id` → `erp_procurement.purchase_order(id)`
- `gate_entry_line.po_line_id` → `erp_procurement.purchase_order_line(id)`
- `gate_entry_line.gate_entry_id` → `erp_procurement.gate_entry(id)`
- `goods_receipt.gate_entry_id` → `erp_procurement.gate_entry(id)`
- `goods_receipt.po_id` → `erp_procurement.purchase_order(id)`
- `goods_receipt_line.grn_id` → `erp_procurement.goods_receipt(id)`
- `goods_receipt_line.gate_entry_line_id` → `erp_procurement.gate_entry_line(id)`
- `goods_receipt_line.po_line_id` → `erp_procurement.purchase_order_line(id)`

### Rule 3: goods_receipt_line.target_stock_type CHECK
```sql
CHECK (target_stock_type IN ('QUALITY_INSPECTION', 'BLOCKED'))
```
Only these two values. GRN cannot receive directly to UNRESTRICTED.

### Rule 4: goods_receipt_line.movement_type_code CHECK
```sql
CHECK (movement_type_code IN ('P101', 'P103'))
```
P101 = receive to QA, P103 = receive to Blocked. Only these two.

### Rule 5: ordered_qty_base_uom is NULLABLE
```sql
ordered_qty_base_uom numeric(20, 6) NULL
```
NULL when `variable_conversion = true` because actual weight is only known at GRN time.

### Rule 6: No handlers, no TypeScript, no frontend
DB only. If you find yourself writing an Edge Function or any `.ts` file — stop. That is Gate-14.

### Rule 7: goods_receipt.reversal_grn_id is a self-referencing FK
```sql
reversal_grn_id uuid NULL REFERENCES erp_procurement.goods_receipt(id)
```
This is intra-table, intra-schema — FK is correct here.

---

## Step 6 — Self-Check

```
[ ] Schema erp_procurement created with 3 GRANT statements
[ ] purchase_order: UNIQUE po_number, status CHECK (6 values), all payment fields
[ ] purchase_order_line: UNIQUE(po_id, line_number), ordered_qty_base_uom nullable
[ ] gate_entry: UNIQUE gate_entry_number, vehicle fields, challan fields, status CHECK
[ ] gate_entry_line: UNIQUE(gate_entry_id, line_number), grn_posted boolean DEFAULT false
[ ] goods_receipt: UNIQUE grn_number, gate_entry_id FK, po_id FK, status CHECK (4 values)
[ ] goods_receipt_line: UNIQUE(grn_id, line_number), target_stock_type CHECK, movement_type_code CHECK
[ ] goods_receipt_line.conversion_factor NOT NULL (actual at GRN time)
[ ] All indexes in 13.5 — both header and line tables
[ ] idx_gel_grn_posted partial index: WHERE grn_posted = false
[ ] NO cross-schema FK anywhere (company_id, plant_id, vendor_id, material_id all plain uuid)
[ ] stock_document_id, stock_ledger_id: plain uuid NULL, no FK
[ ] All files: Gate: 13, Phase: 13, Domain: PROCUREMENT
[ ] No tables in public schema
```

---

## Step 7 — Log Update

File: `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

After each file, update the Gate-13 table row:
```
| 13.X | item name | DONE | supabase/migrations/filename.sql | - | - |
```

After all 5 files:
```
Gate-13 implementation complete. All 5 migrations created. Awaiting Claude verification.
```

---

## Step 8 — Hard Stop

After Gate-13, stop. Claude verifies. Then Gate-14 (handlers) brief will be issued.

---

*Task issued: 2026-05-09*
*Gate-11 VERIFIED ✅ | Gate-12 VERIFIED ✅*
*Do not start Gate-14 until Claude marks Gate-13 VERIFIED.*
