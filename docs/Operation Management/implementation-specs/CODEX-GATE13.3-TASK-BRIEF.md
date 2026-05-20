# CODEX TASK BRIEF — Gate-13.3: CSN DB (erp_procurement)

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-11
**Gate:** 13.3
**Dependency status:** Gate-13.2 VERIFIED ✅ — proceed
**Your task:** Create 2 SQL migration files. Nothing else.

---

## Step 1 — Read These Files First

1. `docs/Operation Management/implementation-specs/OM-GATE-13.3-CSN-DB-Spec.md`
2. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

---

## Step 2 — What You Are Building

The Consignment Note table. Auto-created per PO line on PO confirm.

```
consignment_note (one per PO line — IMPORT/DOMESTIC/BULK types)
  ├── Mother CSN (is_mother_csn = true)
  │     └── Sub CSN (mother_csn_id set)
  └── Bulk CSN (multiple GEs, stays OPEN until PO balance = 0)
```

**This gate is DB structures only. No handlers. No frontend.**

---

## Step 3 — Files to Create

| File | What it does |
|---|---|
| `20260511030000_gate13_3_13_3_1_create_consignment_note.sql` | CSN table — full field set for all 3 types |
| `20260511031000_gate13_3_13_3_2_create_csn_indexes.sql` | Indexes including LC alert + Vessel Booking alert indexes |

All go in: `supabase/migrations/`

---

## Step 4 — File Header

```sql
/*
 * File-ID: 13.3.X
 * File-Path: supabase/migrations/20260511HHMMSS_gate13_3_13_3_X_description.sql
 * Gate: 13.3
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: One sentence.
 * Authority: Backend
 */
```

---

## Step 5 — Critical Rules

### Rule 1: NO cross-schema FK constraints
Plain uuid NULL (no REFERENCES):
- `company_id`, `vendor_id`, `material_id`, `material_category_id`
- `payment_term_id`, `port_of_discharge_id`, `cha_id`
- `transporter_id`, `domestic_transporter_id`
- `sto_id` → STO table not yet created (Gate-13.7)
- `gate_entry_id` → GE table not yet created (Gate-13.4)
- `grn_id` → GRN table not yet created (Gate-13.5)

### Rule 2: Intra-schema FKs ARE correct
- `po_id` → `erp_procurement.purchase_order(id)`
- `po_line_id` → `erp_procurement.purchase_order_line(id)`
- `mother_csn_id` → `erp_procurement.consignment_note(id)` (self-reference — correct)

### Rule 3: status CHECK — 6 values
```sql
CHECK (status IN ('ORDERED', 'IN_TRANSIT', 'ARRIVED', 'GRN_DONE', 'OPEN', 'CLOSED'))
```
IMPORT/DOMESTIC use ORDERED→IN_TRANSIT→ARRIVED→GRN_DONE→CLOSED.
BULK uses OPEN→CLOSED.

### Rule 4: csn_type CHECK — 3 values
```sql
CHECK (csn_type IN ('IMPORT', 'DOMESTIC', 'BULK'))
```

### Rule 5: Alert indexes — create both
```sql
idx_csn_lc_alert     WHERE lc_required = true AND status NOT IN ('GRN_DONE','CLOSED')
idx_csn_vessel_alert WHERE csn_type = 'IMPORT' AND vessel_booking_confirmed_date IS NULL AND status NOT IN (...)
```

---

## Step 6 — Self-Check

```
[ ] consignment_note table exists in erp_procurement schema
[ ] csn_number UNIQUE
[ ] csn_type CHECK (IMPORT/DOMESTIC/BULK)
[ ] status CHECK (6 values)
[ ] po_id FK → erp_procurement.purchase_order(id)
[ ] po_line_id FK → erp_procurement.purchase_order_line(id)
[ ] mother_csn_id self-reference FK → erp_procurement.consignment_note(id)
[ ] sto_id plain uuid NULL (no FK)
[ ] gate_entry_id plain uuid NULL (no FK)
[ ] grn_id plain uuid NULL (no FK)
[ ] All cross-schema IDs are plain uuid (no REFERENCES)
[ ] Both alert partial indexes created
[ ] GRANT SELECT to authenticated, GRANT ALL to service_role
```

---

## Step 7 — Log Update

After each file:
```
| 13.3.X | item name | DONE | supabase/migrations/filename.sql | - | - |
```
After all 2:
```
Gate-13.3 implementation complete. All 2 migrations created. Awaiting Claude verification.
```

---

## Step 8 — Hard Stop

After Gate-13.3, stop. Claude verifies. Then Gate-13.4 (Gate Entry + Gate Exit) brief.

---

*Task issued: 2026-05-11 | Gate-13.2 VERIFIED ✅*
