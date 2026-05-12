# CODEX TASK BRIEF — Gate-13.4: Gate Entry + Inbound Gate Exit DB

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-11
**Gate:** 13.4
**Dependency status:** Gate-13.3 VERIFIED ✅ — proceed
**Your task:** Create 3 SQL migration files. Nothing else.

---

## Step 1 — Read These Files First

1. `docs/Operation Management/implementation-specs/OM-GATE-13.4-GateEntry-DB-Spec.md`
2. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

---

## Step 2 — What You Are Building

```
gate_entry (header — vehicle, date, type)
    ↓
gate_entry_line (lines — PO/STO ref, CSN link, weighment fields)

gate_exit_inbound (BULK/TANKER tare weight capture — one per GE)
    → Net Weight = GE Gross − Tare → feeds GRN
```

**This gate is DB structures only. No handlers. No frontend.**

---

## Step 3 — Files to Create

| File | What it does |
|---|---|
| `20260511040000_gate13_4_13_4_1_create_gate_entry.sql` | GE header + lines |
| `20260511041000_gate13_4_13_4_2_create_gate_exit_inbound.sql` | Inbound gate exit (tare weight) |
| `20260511042000_gate13_4_13_4_3_create_gate_entry_indexes.sql` | All indexes + grants |

---

## Step 4 — File Header

```sql
/*
 * File-ID: 13.4.X
 * File-Path: supabase/migrations/20260511HHMMSS_gate13_4_13_4_X_description.sql
 * Gate: 13.4
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: One sentence.
 * Authority: Backend
 */
```

---

## Step 5 — Critical Rules

### Rule 1: NO cross-schema FK
- `gate_entry.company_id`, `plant_id` — plain uuid
- `gate_entry_line.material_id` — plain uuid
- `gate_entry_line.sto_id`, `sto_line_id` — plain uuid NULL (STO table in Gate-13.7)
- `gate_exit_inbound.company_id`, `plant_id` — plain uuid

### Rule 2: Intra-schema FKs ARE correct
- `gate_entry_line.gate_entry_id` → `gate_entry(id)`
- `gate_entry_line.po_id` → `purchase_order(id)` (nullable)
- `gate_entry_line.po_line_id` → `purchase_order_line(id)` (nullable)
- `gate_entry_line.csn_id` → `consignment_note(id)` (nullable)
- `gate_exit_inbound.gate_entry_id` → `gate_entry(id)`

### Rule 3: gate_exit_inbound UNIQUE(gate_entry_id)
One Gate Exit per Gate Entry.

### Rule 4: grn_posted partial index
```sql
CREATE INDEX ... ON gate_entry_line (gate_entry_id) WHERE grn_posted = false;
```

### Rule 5: ge_type CHECK
```sql
CHECK (ge_type IN ('INBOUND_PO', 'INBOUND_STO'))
```

---

## Step 6 — Self-Check

```
[ ] gate_entry: ge_number UNIQUE, ge_type CHECK, status CHECK
[ ] gate_entry_line: UNIQUE(gate_entry_id, line_number)
[ ] gate_entry_line: grn_posted boolean DEFAULT false
[ ] gate_entry_line: csn_id intra-schema FK to consignment_note (nullable)
[ ] gate_entry_line: sto_id plain uuid NULL (no FK)
[ ] gate_exit_inbound: UNIQUE(gate_entry_id)
[ ] gate_exit_inbound: gate_entry_id FK to gate_entry(id)
[ ] idx_gel_grn_posted partial index WHERE grn_posted = false
[ ] GRANT SELECT to authenticated on all 3 tables
[ ] No cross-schema FK anywhere
```

---

## Step 7 — Log Update

After all 3:
```
Gate-13.4 implementation complete. All 3 migrations created. Awaiting Claude verification.
```

## Step 8 — Hard Stop

After Gate-13.4, stop. Claude verifies. Then Gate-13.5 (GRN).

---

*Task issued: 2026-05-11 | Gate-13.3 VERIFIED ✅*
