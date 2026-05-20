# CODEX TASK BRIEF — Gate-13.6: Inward QA DB (erp_procurement)

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-11
**Gate:** 13.6
**Dependency status:** Gate-13.5 VERIFIED ✅ — proceed
**Your task:** Create 2 SQL migration files. Nothing else.

---

## Step 1 — Read These Files First

1. `docs/Operation Management/implementation-specs/OM-GATE-13.6-InwardQA-DB-Spec.md`
2. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

---

## Step 2 — What You Are Building

```
inward_qa_document (one per GRN line → QA_STOCK)
    ├── inward_qa_test_line (test results: VISUAL/MCT/LAB)
    └── inward_qa_decision_line (usage decision: RELEASE/BLOCK/REJECT/SCRAP/FOR_REPROCESS)
```

**This gate is DB structures only. No handlers. No frontend.**

---

## Step 3 — Files to Create

| File | What it does |
|---|---|
| `20260511060000_gate13_6_13_6_1_create_inward_qa.sql` | QA document + test lines + decision lines |
| `20260511061000_gate13_6_13_6_2_create_qa_indexes.sql` | Indexes including pending-QA partial index |

---

## Step 4 — File Header

```sql
/*
 * File-ID: 13.6.X
 * File-Path: supabase/migrations/20260511HHMMSS_gate13_6_13_6_X_description.sql
 * Gate: 13.6
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: One sentence.
 * Authority: Backend
 */
```

---

## Step 5 — Critical Rules

### Rule 1: NO cross-schema FK
- `inward_qa_document.company_id`, `plant_id`, `material_id`, `vendor_id` — plain uuid
- `inward_qa_decision_line.stock_document_id`, `stock_ledger_id` — plain uuid NULL

### Rule 2: Intra-schema FKs ARE correct
- `inward_qa_document.grn_id` → `goods_receipt(id)`
- `inward_qa_document.grn_line_id` → `goods_receipt_line(id)`
- `inward_qa_document.po_id` → `purchase_order(id)` (nullable)
- `inward_qa_test_line.qa_document_id` → `inward_qa_document(id)`
- `inward_qa_decision_line.qa_document_id` → `inward_qa_document(id)`

### Rule 3: usage_decision CHECK — 5 values
```sql
CHECK (usage_decision IN ('RELEASE','BLOCK','REJECT','SCRAP','FOR_REPROCESS'))
```

### Rule 4: movement_type_code CHECK — 4 values
```sql
CHECK (movement_type_code IN ('P321','P344','P553','FOR_REPROCESS'))
```

### Rule 5: test_type CHECK — 4 values
```sql
CHECK (test_type IN ('VISUAL','MCT','LAB','OTHER'))
```

### Rule 6: Pending QA partial index
```sql
CREATE INDEX ... WHERE status IN ('PENDING', 'IN_PROGRESS')
```

---

## Step 6 — Self-Check

```
[ ] inward_qa_document: qa_number UNIQUE, status CHECK (3 values)
[ ] inward_qa_test_line: UNIQUE(qa_document_id, line_number), test_type CHECK, pass_fail CHECK
[ ] inward_qa_decision_line: UNIQUE(qa_document_id, decision_line_number)
[ ] inward_qa_decision_line: usage_decision CHECK (5 values)
[ ] inward_qa_decision_line: movement_type_code CHECK (4 values)
[ ] inward_qa_decision_line: stock_document_id, stock_ledger_id plain uuid NULL
[ ] Partial index for pending QA documents created
[ ] GRANT SELECT to authenticated on all 3 tables
[ ] No cross-schema FK anywhere
```

---

## Step 7 — Log Update

After all 2:
```
Gate-13.6 implementation complete. All 2 migrations created. Awaiting Claude verification.
```

## Step 8 — Hard Stop

After Gate-13.6, stop. Claude verifies. Then Gate-13.7 (STO).

---

*Task issued: 2026-05-11 | Gate-13.5 VERIFIED ✅*
