# OM-GATE-16.0 — Stock Posting Engine (DB Migration)
# PACE-ERP Operation Management — erp_inventory

**Gate:** 16.0
**Phase:** Operation Management — Layer 2 Backend prerequisite
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-13.9 VERIFIED ✅
**Design Reference:** Section 77 (stock ledger authoritative), Gate-11 schema

---

## 1. What You Are Building

A PostgreSQL function `erp_inventory.post_stock_movement()` that atomically:
1. INSERTs into `erp_inventory.stock_document`
2. INSERTs into `erp_inventory.stock_ledger`
3. UPSERTs `erp_inventory.stock_snapshot` (increment or decrement qty + recompute weighted average rate)

This function is the ONLY way stock moves in the system. All L2 handlers (GRN, QA, STO, RTV, SO) call this via `serviceRoleClient.rpc('post_stock_movement', {...})`.

**No TypeScript handler in this gate.** DB migration only.

---

## 2. File to Create

| File-ID | Filename |
|---|---|
| 16.0.1 | `20260512000000_gate16_0_16_0_1_create_stock_posting_engine.sql` |

File goes in: `supabase/migrations/`

---

## 3. Migration Spec

**File header:**
```sql
/*
 * File-ID: 16.0.1
 * File-Path: supabase/migrations/20260512000000_gate16_0_16_0_1_create_stock_posting_engine.sql
 * Gate: 16.0
 * Phase: 16
 * Domain: INVENTORY
 * Purpose: Atomic stock posting engine — stock_document + stock_ledger + stock_snapshot in one function.
 * Authority: Backend
 */
```

### Function Signature

```sql
CREATE OR REPLACE FUNCTION erp_inventory.post_stock_movement(
  p_document_number     text,          -- caller provides (from generate_doc_number)
  p_document_date       date,
  p_posting_date        date,
  p_movement_type_code  text,          -- must exist in movement_type_master
  p_company_id          uuid,
  p_plant_id            uuid,
  p_storage_location_id uuid,          -- must exist in storage_location_master
  p_material_id         uuid,
  p_quantity            numeric(20,6), -- always positive
  p_base_uom_code       text,
  p_unit_value          numeric(20,4), -- per-unit value (used for IN movements)
  p_stock_type_code     text,          -- must exist in stock_type_master
  p_direction           text,          -- 'IN' or 'OUT'
  p_posted_by           uuid,
  p_reversal_of_id      uuid DEFAULT NULL
)
RETURNS TABLE (
  stock_document_id uuid,
  stock_ledger_id   uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
```

### Business Logic

**Step 1 — Validate direction:**
```sql
IF p_direction NOT IN ('IN', 'OUT') THEN
  RAISE EXCEPTION 'INVALID_DIRECTION: must be IN or OUT';
END IF;
```

**Step 2 — Insert stock_document:**
```sql
INSERT INTO erp_inventory.stock_document (
  document_number, document_date, posting_date,
  movement_type_code, company_id, plant_id,
  source_storage_location_id,   -- NULL for IN
  target_storage_location_id,   -- NULL for OUT
  material_id, quantity, base_uom_code,
  value, valuation_rate,
  posted_by, status, reversal_of_id, created_by
) VALUES (
  p_document_number, p_document_date, p_posting_date,
  p_movement_type_code, p_company_id, p_plant_id,
  CASE WHEN p_direction = 'OUT' THEN p_storage_location_id ELSE NULL END,
  CASE WHEN p_direction = 'IN'  THEN p_storage_location_id ELSE NULL END,
  p_material_id, p_quantity, p_base_uom_code,
  p_quantity * p_unit_value,  -- total value
  p_unit_value,
  p_posted_by, 'POSTED', p_reversal_of_id, p_posted_by
) RETURNING id INTO v_stock_doc_id;
```

**Step 3 — Insert stock_ledger:**
```sql
INSERT INTO erp_inventory.stock_ledger (
  stock_document_id, posting_date,
  company_id, plant_id, storage_location_id,
  material_id, stock_type_code, movement_type_code,
  direction, quantity, base_uom_code,
  value, valuation_rate, created_by
) VALUES (
  v_stock_doc_id, p_posting_date,
  p_company_id, p_plant_id, p_storage_location_id,
  p_material_id, p_stock_type_code, p_movement_type_code,
  p_direction, p_quantity, p_base_uom_code,
  p_quantity * p_unit_value, p_unit_value, p_posted_by
) RETURNING id INTO v_ledger_id;
```

**Step 4 — UPSERT stock_snapshot:**

For `direction = 'IN'` (weighted average rate recalculation):
```sql
new_qty   = old_qty + p_quantity
new_value = old_value + (p_quantity * p_unit_value)
new_rate  = new_value / new_qty   (avoid divide-by-zero: use p_unit_value if new_qty = 0)
```

For `direction = 'OUT'` (rate unchanged, qty decrements):
```sql
new_qty   = old_qty - p_quantity
new_value = old_value - (p_quantity * current_valuation_rate)
new_rate  = current_valuation_rate  (unchanged on issue)
```

Use ON CONFLICT ON CONSTRAINT `idx_ss_unique_stock_position` (unique on company_id, plant_id, storage_location_id, material_id, stock_type_code).

**Step 5 — Return:**
```sql
RETURN QUERY SELECT v_stock_doc_id, v_ledger_id;
```

### GRANT

```sql
GRANT EXECUTE ON FUNCTION erp_inventory.post_stock_movement(...) TO service_role;
```

---

## 4. Critical Rules

| Rule | Detail |
|---|---|
| SECURITY DEFINER | Function runs with owner privileges — no RLS bypass needed |
| Atomicity | All 3 steps in one PG transaction — either all succeed or all fail |
| p_document_number | Caller generates via `erp_procurement.generate_doc_number()` before calling |
| p_unit_value | For OUT movements: pass current snapshot valuation_rate |
| Negative qty guard | If OUT would make snapshot qty negative → RAISE EXCEPTION 'INSUFFICIENT_STOCK' |
| stock_type_code validation | Check exists in erp_inventory.stock_type_master before insert |
| storage_location_id | For source/target: pass the actual location. Function sets correct column. |

---

## 5. Verification — Claude Will Check

1. Function signature matches spec (parameter names + types)
2. SECURITY DEFINER present
3. All 3 INSERT/UPSERT in one function body (atomic)
4. Weighted average recalculated correctly on IN movements
5. Negative qty guard present for OUT movements
6. GRANT EXECUTE to service_role
7. BEGIN/COMMIT wrapping entire migration

---

*Spec frozen: 2026-05-12 | Prerequisite for all Gate-16.x*
