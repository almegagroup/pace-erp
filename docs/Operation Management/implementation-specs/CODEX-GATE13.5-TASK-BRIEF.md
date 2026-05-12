# CODEX TASK BRIEF — Gate-13.5: GRN DB (erp_procurement)

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-11
**Gate:** 13.5
**Dependency status:** Gate-13.4 VERIFIED ✅ — proceed
**Your task:** Create 2 SQL migration files. Nothing else.

---

## Step 1 — Read These Files First

1. `docs/Operation Management/implementation-specs/OM-GATE-13.5-GRN-DB-Spec.md`
2. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

---

## Step 2 — What You Are Building

```
goods_receipt (header — one per GE, movement type, reversal)
    ↓
goods_receipt_line (lines — received qty, storage location, stock type, batch)
```

**This gate is DB structures only. No handlers. No frontend.**

---

## Step 3 — Files to Create

| File | What it does |
|---|---|
| `20260511050000_gate13_5_13_5_1_create_goods_receipt.sql` | GRN header + lines |
| `20260511051000_gate13_5_13_5_2_create_grn_indexes.sql` | Indexes + grants |

---

## Step 4 — File Header

```sql
/*
 * File-ID: 13.5.X
 * File-Path: supabase/migrations/20260511HHMMSS_gate13_5_13_5_X_description.sql
 * Gate: 13.5
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: One sentence.
 * Authority: Backend
 */
```

---

## Step 5 — Critical Rules

### Rule 1: NO cross-schema FK
- `goods_receipt.company_id`, `vendor_id` — plain uuid
- `goods_receipt.sto_id` — plain uuid NULL
- `goods_receipt_line.material_id` — plain uuid
- `goods_receipt_line.storage_location_id` — plain uuid NULL (erp_inventory)
- `goods_receipt_line.sto_line_id` — plain uuid NULL
- `goods_receipt_line.stock_document_id`, `stock_ledger_id` — plain uuid NULL

### Rule 2: Intra-schema FKs ARE correct
- `goods_receipt.gate_entry_id` → `gate_entry(id)`
- `goods_receipt.po_id` → `purchase_order(id)` (nullable)
- `goods_receipt.reversal_grn_id` → `goods_receipt(id)` (self-reference)
- `goods_receipt_line.grn_id` → `goods_receipt(id)`
- `goods_receipt_line.gate_entry_line_id` → `gate_entry_line(id)`
- `goods_receipt_line.po_line_id` → `purchase_order_line(id)` (nullable)

### Rule 3: UNIQUE(gate_entry_id) on goods_receipt
One GRN per GE.

### Rule 4: target_stock_type CHECK
```sql
CHECK (target_stock_type IN ('UNRESTRICTED', 'QA_STOCK', 'BLOCKED'))
```

### Rule 5: movement_type_code CHECK
```sql
CHECK (movement_type_code IN ('P101', 'STO_RECEIPT', 'P102'))
```

### Rule 6: reversal_grn_id is self-referencing FK
```sql
reversal_grn_id uuid NULL REFERENCES erp_procurement.goods_receipt(id)
```
Intra-table, intra-schema — FK is correct here.

---

## Step 6 — Self-Check

```
[ ] goods_receipt: UNIQUE grn_number, UNIQUE(gate_entry_id)
[ ] goods_receipt: status CHECK (DRAFT/POSTED/REVERSED)
[ ] goods_receipt: movement_type_code CHECK (P101/STO_RECEIPT/P102)
[ ] goods_receipt: reversal_grn_id self-ref FK on goods_receipt(id)
[ ] goods_receipt: sto_id plain uuid NULL (no FK)
[ ] goods_receipt_line: UNIQUE(grn_id, line_number)
[ ] goods_receipt_line: target_stock_type CHECK (3 values)
[ ] goods_receipt_line: stock_document_id, stock_ledger_id plain uuid NULL
[ ] goods_receipt_line: storage_location_id plain uuid NULL
[ ] GRANT SELECT to authenticated on both tables
[ ] No cross-schema FK anywhere
```

---

## Step 7 — Log Update

After all 2:
```
Gate-13.5 implementation complete. All 2 migrations created. Awaiting Claude verification.
```

## Step 8 — Hard Stop

After Gate-13.5, stop. Claude verifies. Then Gate-13.6 (Inward QA).

---

*Task issued: 2026-05-11 | Gate-13.4 VERIFIED ✅*
