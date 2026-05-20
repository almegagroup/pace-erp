# CODEX TASK BRIEF — Gate-13.7: STO + DC + Gate Exit Outbound DB

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-11
**Gate:** 13.7
**Dependency status:** Gate-13.3 VERIFIED ✅ — proceed (can run parallel with Gate-13.6)
**Your task:** Create 4 SQL migration files. Nothing else.

---

## Step 1 — Read These Files First

1. `docs/Operation Management/implementation-specs/OM-GATE-13.7-STO-DB-Spec.md`
2. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

---

## Step 2 — What You Are Building

```
stock_transfer_order (header — CONSIGNMENT_DISTRIBUTION / INTER_PLANT)
    ↓
stock_transfer_order_line (material, qty, transfer price)

delivery_challan (auto-generated on stock issue — shared by STO + Sales)
    ↓
delivery_challan_line (material, qty, value)

gate_exit_outbound (truck exit: STO dispatch / Sales / RTV)
```

**This gate is DB structures only. No handlers. No frontend.**

---

## Step 3 — Files to Create

| File | What it does |
|---|---|
| `20260511070000_gate13_7_13_7_1_create_stock_transfer_order.sql` | STO header + lines |
| `20260511071000_gate13_7_13_7_2_create_delivery_challan.sql` | DC header + lines |
| `20260511072000_gate13_7_13_7_3_create_gate_exit_outbound.sql` | Outbound Gate Exit |
| `20260511073000_gate13_7_13_7_4_create_sto_indexes.sql` | All indexes + grants |

---

## Step 4 — File Header

```sql
/*
 * File-ID: 13.7.X
 * File-Path: supabase/migrations/20260511HHMMSS_gate13_7_13_7_X_description.sql
 * Gate: 13.7
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: One sentence.
 * Authority: Backend
 */
```

---

## Step 5 — Critical Rules

### Rule 1: NO cross-schema FK
- `stock_transfer_order.sending_company_id`, `receiving_company_id` — plain uuid
- `stock_transfer_order_line.material_id` — plain uuid
- `stock_transfer_order_line.sending_storage_location_id`, `receiving_storage_location_id` — plain uuid NULL
- `delivery_challan.customer_id` — plain uuid NULL
- `delivery_challan.transporter_id` — plain uuid NULL
- `delivery_challan.sales_order_id` — plain uuid NULL (SO table in Gate-13.9)
- `delivery_challan_line.so_line_id` — plain uuid NULL
- `delivery_challan_line.stock_document_id` — plain uuid NULL
- `gate_exit_outbound.company_id`, `plant_id` — plain uuid
- `gate_exit_outbound.sales_order_id`, `rtv_id` — plain uuid NULL
- `gate_exit_outbound.transporter_id` — plain uuid NULL

### Rule 2: Intra-schema FKs ARE correct
- `stock_transfer_order.related_csn_id` → `consignment_note(id)` (nullable)
- `stock_transfer_order_line.sto_id` → `stock_transfer_order(id)`
- `delivery_challan.sto_id` → `stock_transfer_order(id)` (nullable)
- `delivery_challan_line.dc_id` → `delivery_challan(id)`
- `delivery_challan_line.sto_line_id` → `stock_transfer_order_line(id)` (nullable)
- `gate_exit_outbound.sto_id` → `stock_transfer_order(id)` (nullable)
- `gate_exit_outbound.dc_id` → `delivery_challan(id)` (nullable)

### Rule 3: sto_type CHECK — 2 values
```sql
CHECK (sto_type IN ('CONSIGNMENT_DISTRIBUTION', 'INTER_PLANT'))
```

### Rule 4: STO status CHECK — 5 values
```sql
CHECK (status IN ('CREATED', 'DISPATCHED', 'RECEIVED', 'CLOSED', 'CANCELLED'))
```

### Rule 5: dc_type CHECK — 2 values
```sql
CHECK (dc_type IN ('STO', 'SALES'))
```

### Rule 6: exit_type CHECK — 3 values
```sql
CHECK (exit_type IN ('STO', 'SALES', 'RTV'))
```

---

## Step 6 — Self-Check

```
[ ] stock_transfer_order: sto_number UNIQUE, sto_type CHECK, status CHECK
[ ] stock_transfer_order_line: UNIQUE(sto_id, line_number), balance_qty field present
[ ] delivery_challan: dc_number UNIQUE, dc_type CHECK, sales_order_id plain uuid NULL
[ ] delivery_challan_line: UNIQUE(dc_id, line_number), so_line_id plain uuid NULL
[ ] gate_exit_outbound: exit_number UNIQUE, exit_type CHECK
[ ] gate_exit_outbound: sales_order_id + rtv_id plain uuid NULL
[ ] All cross-schema IDs are plain uuid (no REFERENCES)
[ ] GRANT SELECT to authenticated on all 5 tables
[ ] No cross-schema FK anywhere
```

---

## Step 7 — Log Update

After all 4:
```
Gate-13.7 implementation complete. All 4 migrations created. Awaiting Claude verification.
```

## Step 8 — Hard Stop

After Gate-13.7, stop. Claude verifies. Gate-13.8 (RTV + IV) spec will be issued next.

---

*Task issued: 2026-05-11 | Gate-13.3 VERIFIED ✅*
